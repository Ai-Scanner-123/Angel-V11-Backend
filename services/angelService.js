const axios = require("axios");
const speakeasy = require("speakeasy");

let jwtToken = null;
let instrumentList = null;
let instrumentLoadedAt = null;

const quoteCache = {};
const QUOTE_CACHE_MS = 5000;

const BASE_URL = "https://apiconnect.angelbroking.com";
const SCRIP_MASTER_URL =
  "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";

function getHeaders() {
  return {
    Authorization: jwtToken ? `Bearer ${jwtToken}` : "",
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "00:00:00:00:00:00",
    "X-PrivateKey": process.env.ANGEL_API_KEY
  };
}

async function login() {
  const totp = speakeasy.totp({
    secret: process.env.ANGEL_TOTP_SECRET,
    encoding: "base32"
  });

  const payload = {
    clientcode: process.env.ANGEL_CLIENT_CODE || process.env.ANGEL_CLIENT_ID,
    password: process.env.ANGEL_PASSWORD || process.env.ANGEL_PIN,
    totp
  };

  const res = await axios.post(
    `${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`,
    payload,
    { headers: getHeaders() }
  );

  if (!res.data?.status) {
    throw new Error(res.data?.message || "Angel login failed");
  }

  jwtToken = res.data.data.jwtToken;

  return {
    success: true,
    message: "Angel login successful"
  };
}

async function loadInstruments() {
  const now = Date.now();

  if (
    instrumentList &&
    instrumentLoadedAt &&
    now - instrumentLoadedAt < 24 * 60 * 60 * 1000
  ) {
    return instrumentList;
  }

  const res = await axios.get(SCRIP_MASTER_URL);

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

  let item = list.find(x => x.exch_seg === "NSE" && x.symbol === exactSymbol && x.token);

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
    token: item.token,
    name: item.name
  };
}

async function getQuote(body = {}) {
  if (!jwtToken) await login();

  const inputSymbol = body.symbol || body.stock || "TCS";
  const cleanInputSymbol = String(inputSymbol).toUpperCase().replace("-EQ", "").trim();

  if (
    quoteCache[cleanInputSymbol] &&
    Date.now() - quoteCache[cleanInputSymbol].time < QUOTE_CACHE_MS
  ) {
    return quoteCache[cleanInputSymbol].data;
  }

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
      { headers: getHeaders() }
    );
  } catch (err) {
    jwtToken = null;
    throw new Error(err.response?.data?.message || err.message || "Quote fetch failed");
  }

  if (!res.data?.status) {
    jwtToken = null;
    throw new Error(res.data?.message || "Quote fetch failed");
  }

  const item = res.data?.data?.fetched?.[0];
  if (!item) throw new Error("No quote data received");
let liveRsi = 55;

try {
  const candleResult = await getCandles({ symbol: found.symbol });

  const closes = (candleResult.candles || [])
    .map(c => Number(c[4]))
    .filter(Boolean);

  liveRsi = calcRSI(closes);

} catch (err) {
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
      raw: item
    }
  };

  quoteCache[cleanInputSymbol] = {
    time: Date.now(),
    data: result
  };

  return result;
}
function calcRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return 55;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];

    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return Number((100 - (100 / (1 + rs))).toFixed(2));
}
async function getCandles(body = {}) {
  if (!jwtToken) await login();

  const inputSymbol = body.symbol || body.stock || "TCS";
  const found = await findNseToken(inputSymbol);

 const now = new Date();
const from = new Date();

from.setHours(9, 15, 0, 0);
now.setHours(15, 30, 0, 0);

  const formatDate = d =>
    d.toISOString().slice(0, 19).replace("T", " ");

  const payload = {
    exchange: "NSE",
    symboltoken: found.token,
    interval: "FIVE_MINUTE",
    fromdate: formatDate(from),
    todate: formatDate(now)
  };

  const res = await axios.post(
    `${BASE_URL}/rest/secure/angelbroking/historical/v1/getCandleData`,
    payload,
    { headers: getHeaders() }
  );

  if (!res.data?.status) {
    throw new Error(res.data?.message || "Candle data failed");
  }

  const candles = res.data.data || [];
console.log("Candles Count:", candles.length);
console.log("First Candle:", candles[0]);
  return {
    success: true,
    symbol: found.symbol,
    token: found.token,
    candles
  };
}
module.exports = {
  login,
  getQuote,
  getCandles,
  findNseToken
};
