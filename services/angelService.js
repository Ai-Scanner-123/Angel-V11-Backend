const axios = require("axios");
const speakeasy = require("speakeasy");

let jwtToken = null;
let instrumentList = null;
let instrumentLoadedAt = null;

const quoteCache = new Map();
const candleCache = new Map();

const QUOTE_CACHE_MS = 5000;
const CANDLE_CACHE_MS = 60000;
const INSTRUMENT_CACHE_MS = 24 * 60 * 60 * 1000;

const BASE_URL = process.env.ANGEL_BASE_URL || "https://apiconnect.angelone.in";
const SCRIP_MASTER_URL =
  "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";

function requiredEnv(name, fallbackName) {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : undefined);
  if (!value) throw new Error(`Missing environment variable: ${name}${fallbackName ? ` or ${fallbackName}` : ""}`);
  return value;
}

function getHeaders() {
  return {
    Authorization: jwtToken ? `Bearer ${jwtToken}` : "",
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": process.env.CLIENT_LOCAL_IP || "127.0.0.1",
    "X-ClientPublicIP": process.env.CLIENT_PUBLIC_IP || "127.0.0.1",
    "X-MACAddress": process.env.CLIENT_MAC_ADDRESS || "00:00:00:00:00:00",
    "X-PrivateKey": process.env.ANGEL_API_KEY || ""
  };
}

function axiosMessage(err, fallback) {
  return (
    err.response?.data?.message ||
    err.response?.data?.error ||
    err.response?.data?.errorcode ||
    err.response?.data ||
    err.message ||
    fallback
  );
}

async function login() {
  const apiKey = requiredEnv("ANGEL_API_KEY");
  const clientcode = requiredEnv("ANGEL_CLIENT_CODE", "ANGEL_CLIENT_ID");
  const password = requiredEnv("ANGEL_PASSWORD", "ANGEL_PIN");
  const secret = requiredEnv("ANGEL_TOTP_SECRET");

  const totp = speakeasy.totp({
    secret,
    encoding: "base32"
  });

  const payload = { clientcode, password, totp };

  const res = await axios.post(
    `${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`,
    payload,
    { headers: { ...getHeaders(), "X-PrivateKey": apiKey } }
  );

  if (!res.data?.status || !res.data?.data?.jwtToken) {
    throw new Error(res.data?.message || "Angel login failed");
  }

  jwtToken = res.data.data.jwtToken;
  return { success: true, message: "Angel login successful" };
}

async function ensureLogin() {
  if (!jwtToken) await login();
}

async function loadInstruments() {
  const now = Date.now();

  if (instrumentList && instrumentLoadedAt && now - instrumentLoadedAt < INSTRUMENT_CACHE_MS) {
    return instrumentList;
  }

  const res = await axios.get(SCRIP_MASTER_URL, { timeout: 30000 });

  if (!Array.isArray(res.data)) {
    throw new Error("Instrument list download failed");
  }

  instrumentList = res.data;
  instrumentLoadedAt = now;
  return instrumentList;
}

async function findNseToken(userSymbol) {
  const list = await loadInstruments();

  const cleanSymbol = String(userSymbol || "")
    .toUpperCase()
    .replace("-EQ", "")
    .trim();

  if (!cleanSymbol) throw new Error("Symbol is required");

  const exactSymbol = `${cleanSymbol}-EQ`;

  let item = list.find(
    x => x.exch_seg === "NSE" && x.symbol === exactSymbol && x.token
  );

  if (!item) {
    item = list.find(
      x => x.exch_seg === "NSE" && x.name === cleanSymbol && x.symbol?.endsWith("-EQ") && x.token
    );
  }

  if (!item) {
    item = list.find(
      x =>
        x.exch_seg === "NSE" &&
        (x.symbol === cleanSymbol || x.symbol === exactSymbol || x.name === cleanSymbol) &&
        x.token
    );
  }

  if (!item) throw new Error(`NSE token not found for ${cleanSymbol}`);

  return {
    symbol: cleanSymbol,
    tradingSymbol: item.symbol,
    token: String(item.token),
    name: item.name
  };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function istNowParts() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    date: ist.getUTCDate(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
    day: ist.getUTCDay()
  };
}

function ymd(parts) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.date)}`;
}

function addDaysIST(parts, days) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.date + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    date: d.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    day: d.getUTCDay()
  };
}

function previousTradingDay(parts) {
  let p = addDaysIST(parts, -1);
  while (p.day === 0 || p.day === 6) {
    p = addDaysIST(p, -1);
  }
  return p;
}

function buildCandleRange() {
  const now = istNowParts();
  const today = ymd(now);
  const prev = ymd(previousTradingDay(now));

  let toDate = today;
  let toHour = now.hour;
  let toMinute = now.minute;

  // Before market has enough current-day candles, use previous session data.
  if (now.hour < 9 || (now.hour === 9 && now.minute < 20) || now.day === 0 || now.day === 6) {
    toDate = prev;
    toHour = 15;
    toMinute = 30;
  } else if (toHour > 15 || (toHour === 15 && toMinute >= 30)) {
    toHour = 15;
    toMinute = 30;
  }

  // Use previous trading day as start so RSI has enough 5-minute candles even soon after market opens.
  return {
    fromdate: `${prev} 09:15`,
    todate: `${toDate} ${pad(toHour)}:${pad(toMinute)}`
  };
}

function normalizeCandles(rawCandles) {
  if (!Array.isArray(rawCandles)) return [];
  return rawCandles
    .filter(c => Array.isArray(c) && c.length >= 6)
    .map(c => ({
      time: c[0],
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5])
    }))
    .filter(c => Number.isFinite(c.close));
}

function calcRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

function calcEMA(closes, period) {
  if (!Array.isArray(closes) || closes.length < period) return null;

  const cleanCloses = closes
    .map(v => Number(v))
    .filter(Number.isFinite);

  if (cleanCloses.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = cleanCloses.slice(0, period).reduce((sum, val) => sum + val, 0) / period;

  for (let i = period; i < cleanCloses.length; i++) {
    ema = (cleanCloses[i] - ema) * multiplier + ema;
  }

  return Number(ema.toFixed(2));
}

async function getCandles(body = {}) {
  await ensureLogin();

  const inputSymbol = body.symbol || body.stock || "TCS";
  const found = await findNseToken(inputSymbol);
  const interval = body.interval || "FIVE_MINUTE";
  const range = buildCandleRange();

  const cacheKey = `${found.symbol}:${interval}:${range.fromdate}:${range.todate}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CANDLE_CACHE_MS) return cached.data;

  // SmartAPI official examples use exchange: "NSE". Keep NSE first; NSE_CM is only a fallback.
  const payloadVariants = [
    { exchange: "NSE", symboltoken: found.token, interval, ...range },
    {
      exchange: "NSE",
      symboltoken: found.token,
      interval,
      fromdate: `${range.fromdate}:00`,
      todate: `${range.todate}:00`
    },
    { exchange: "NSE_CM", symboltoken: found.token, interval, ...range }
  ];

  let lastError;

  for (const payload of payloadVariants) {
    try {
      console.log("CANDLE PAYLOAD:", payload);

      const res = await axios.post(
        `${BASE_URL}/rest/secure/angelbroking/historical/v1/getCandleData`,
        payload,
        { headers: getHeaders(), timeout: 30000 }
      );

      if (!res.data?.status) {
        lastError = new Error(res.data?.message || res.data?.errorcode || "Candle data failed");
        console.log("CANDLE API RESPONSE:", JSON.stringify(res.data));
        continue;
      }

      const rawCandles = res.data.data || [];
      const candles = normalizeCandles(rawCandles);
      const result = {
        success: true,
        symbol: found.symbol,
        tradingSymbol: found.tradingSymbol,
        token: found.token,
        interval,
        fromdate: payload.fromdate,
        todate: payload.todate,
        candles,
        rawCandles
      };

      candleCache.set(cacheKey, { time: Date.now(), data: result });
      return result;
    } catch (err) {
      lastError = err;
      const msg = axiosMessage(err, "Candle data failed");
      console.log("CANDLE ERROR:", err.response?.status || "NO_STATUS", JSON.stringify(msg));

      // 403 rate limit should not be retried immediately.
      if (err.response?.status === 403) break;
    }
  }

  throw new Error(typeof lastError?.message === "string" ? lastError.message : "Candle data failed");
}

async function getQuote(body = {}) {
  await ensureLogin();

  const inputSymbol = body.symbol || body.stock || "TCS";
  const cleanInputSymbol = String(inputSymbol).toUpperCase().replace("-EQ", "").trim();

  const cached = quoteCache.get(cleanInputSymbol);
  if (cached && Date.now() - cached.time < QUOTE_CACHE_MS) return cached.data;

  const found = await findNseToken(inputSymbol);

  const payload = {
    mode: "FULL",
    exchangeTokens: {
      NSE: [found.token]
    }
  };

  let res;
  try {
    res = await axios.post(
      `${BASE_URL}/rest/secure/angelbroking/market/v1/quote/`,
      payload,
      { headers: getHeaders(), timeout: 30000 }
    );
  } catch (err) {
    jwtToken = null;
    throw new Error(axiosMessage(err, "Quote fetch failed"));
  }

  if (!res.data?.status) {
    jwtToken = null;
    throw new Error(res.data?.message || "Quote fetch failed");
  }

  const item = res.data?.data?.fetched?.[0];
  if (!item) throw new Error("No quote data received");

  let liveRsi = null;
  let liveEma9 = null;
  let liveEma20 = null;
  let rsiSource = "ANGEL_CANDLES";
  let emaSource = "ANGEL_CANDLES";
  let candleCount = 0;

  try {
    const candleResult = await getCandles({ symbol: found.symbol, interval: "FIVE_MINUTE" });
    const closes = candleResult.candles
      .map(c => Number(c.close))
      .filter(Number.isFinite);

    candleCount = closes.length;
    liveRsi = calcRSI(closes);
    liveEma9 = calcEMA(closes, 9);
    liveEma20 = calcEMA(closes, 20);
  } catch (err) {
    rsiSource = "UNAVAILABLE";
    emaSource = "UNAVAILABLE";
    console.log("RSI/EMA Error:", err.message);
  }

  const result = {
    success: true,
    data: {
      symbol: found.symbol,
      tradingSymbol: found.tradingSymbol,
      token: found.token,
      ltp: item.ltp,
      price: item.ltp,
      previousClose: item.close,
      high: item.high,
      low: item.low,
      open: item.open,
      volume: item.tradeVolume,
      rsi: liveRsi,
      ema9: liveEma9,
      ema20: liveEma20,
      rsiSource,
      emaSource,
      candleCount,
      raw: item
    }
  };

  quoteCache.set(cleanInputSymbol, { time: Date.now(), data: result });
  return result;
}

module.exports = {
  login,
  getQuote,
  getCandles,
  findNseToken,
  calcRSI,
  calcEMA
};
