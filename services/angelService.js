const axios = require("axios");
const speakeasy = require("speakeasy");

let jwtToken = null;
let instrumentList = null;
let instrumentLoadedAt = null;

const quoteCache = new Map();
const candleCache = new Map();
const candleLastGoodCache = new Map();
const candlePendingRequests = new Map();
const candleRateLimitUntil = new Map();

const QUOTE_CACHE_MS = 5000;
const CANDLE_CACHE_MS = 300000; // 5 minutes cache to reduce Angel API rate limit
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

function calcEMA(closes, period) {
  if (!Array.isArray(closes) || closes.length < period) return null;

  const cleanCloses = closes.map(Number).filter(Number.isFinite);
  if (cleanCloses.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = cleanCloses.slice(0, period).reduce((sum, val) => sum + val, 0) / period;

  for (let i = period; i < cleanCloses.length; i++) {
    ema = (cleanCloses[i] - ema) * multiplier + ema;
  }

  return Number(ema.toFixed(2));
}


function calcEMAFull(values, period) {
  const cleanValues = (values || []).map(Number).filter(Number.isFinite);
  if (cleanValues.length < period) return [];

  const multiplier = 2 / (period + 1);
  const result = new Array(cleanValues.length).fill(null);
  let ema = cleanValues.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  result[period - 1] = ema;

  for (let i = period; i < cleanValues.length; i++) {
    ema = (cleanValues[i] - ema) * multiplier + ema;
    result[i] = ema;
  }

  return result;
}

function calcMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const cleanCloses = (closes || []).map(Number).filter(Number.isFinite);
  if (cleanCloses.length < slowPeriod + signalPeriod) {
    return { macd: null, signal: null, histogram: null, status: "UNAVAILABLE" };
  }

  const fastEMA = calcEMAFull(cleanCloses, fastPeriod);
  const slowEMA = calcEMAFull(cleanCloses, slowPeriod);

  const macdSeries = [];
  for (let i = 0; i < cleanCloses.length; i++) {
    if (fastEMA[i] !== null && slowEMA[i] !== null) {
      macdSeries.push(fastEMA[i] - slowEMA[i]);
    }
  }

  if (macdSeries.length < signalPeriod) {
    return { macd: null, signal: null, histogram: null, status: "UNAVAILABLE" };
  }

  const signalSeries = calcEMAFull(macdSeries, signalPeriod).filter(v => v !== null);
  const macd = macdSeries[macdSeries.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  const histogram = macd - signal;

  let status = "NEUTRAL";
  if (macd > signal && histogram > 0) status = "BULLISH MOMENTUM";
  else if (macd < signal && histogram < 0) status = "BEARISH MOMENTUM";
  else if (Math.abs(histogram) <= 0.05) status = "FLAT / WAIT";

  return {
    macd: Number(macd.toFixed(2)),
    signal: Number(signal.toFixed(2)),
    histogram: Number(histogram.toFixed(2)),
    status
  };
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

async function getCandles(body = {}) {
  await ensureLogin();

  const inputSymbol = body.symbol || body.stock || "TCS";
  const found = await findNseToken(inputSymbol);
  const interval = body.interval || "FIVE_MINUTE";
  const range = buildCandleRange();

  // Cache key intentionally avoids minute-by-minute todate so repeated Fetch Live Data
  // does not hit Angel candle API repeatedly and cause 403 rate-limit.
  const cacheKey = `${found.symbol}:${interval}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CANDLE_CACHE_MS) return cached.data;

  const cooldownUntil = candleRateLimitUntil.get(cacheKey) || 0;
  const lastGood = candleLastGoodCache.get(cacheKey);
  if (Date.now() < cooldownUntil && lastGood) {
    return { ...lastGood, rateLimitFallback: true, message: "Using cached candles due to Angel API rate limit" };
  }

  const pending = candlePendingRequests.get(cacheKey);
  if (pending) return pending;

  const requestPromise = (async () => {
    // Use one stable payload first. Repeated fallback attempts can trigger Angel rate-limit.
    const payload = { exchange: "NSE", symboltoken: found.token, interval, ...range };

    try {
      console.log("CANDLE PAYLOAD:", payload);

      const res = await axios.post(
        `${BASE_URL}/rest/secure/angelbroking/historical/v1/getCandleData`,
        payload,
        { headers: getHeaders(), timeout: 30000 }
      );

      if (!res.data?.status) {
        const msg = res.data?.message || res.data?.errorcode || "Candle data failed";
        console.log("CANDLE API RESPONSE:", JSON.stringify(res.data));
        throw new Error(msg);
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
      candleLastGoodCache.set(cacheKey, result);
      return result;
    } catch (err) {
      const msg = axiosMessage(err, "Candle data failed");
      console.log("CANDLE ERROR:", err.response?.status || "NO_STATUS", JSON.stringify(msg));

      if (err.response?.status === 403 || String(msg).toLowerCase().includes("access rate")) {
        candleRateLimitUntil.set(cacheKey, Date.now() + CANDLE_CACHE_MS);
        if (lastGood) {
          return { ...lastGood, rateLimitFallback: true, message: "Using cached candles due to Angel API rate limit" };
        }
      }

      throw new Error(typeof err?.message === "string" ? err.message : "Candle data failed");
    } finally {
      candlePendingRequests.delete(cacheKey);
    }
  })();

  candlePendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
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
  let ema9 = null;
  let ema20 = null;
  let macd = null;
  let macdSignal = null;
  let histogram = null;
  let macdStatus = "UNAVAILABLE";
  let rsiSource = "ANGEL_CANDLES";
  let candleCount = 0;

  try {
    const candleResult = await getCandles({ symbol: found.symbol, interval: "FIVE_MINUTE" });
    const closes = candleResult.candles
      .map(c => Number(c.close))
      .filter(Number.isFinite);

    candleCount = closes.length;
    liveRsi = calcRSI(closes);
    ema9 = calcEMA(closes, 9);
    ema20 = calcEMA(closes, 20);

    const macdData = calcMACD(closes);
    macd = macdData.macd;
    macdSignal = macdData.signal;
    histogram = macdData.histogram;
    macdStatus = macdData.status;
  } catch (err) {
    rsiSource = "UNAVAILABLE";
    console.log("RSI Error:", err.message);
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
      ema9,
      ema20,
      macd,
      macdSignal,
      signal: macdSignal,
      histogram,
      macdStatus,
      rsiSource,
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
  calcEMA,
  calcMACD
};
