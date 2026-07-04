const axios = require("axios");
const speakeasy = require("speakeasy");

let jwtToken = null;
let instrumentList = null;
let instrumentLoadedAt = null;

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
    clientcode: process.env.ANGEL_CLIENT_CODE,
    password: process.env.ANGEL_PASSWORD,
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

  if (!cleanSymbol) {
    throw new Error("Symbol is required");
  }

  const exactSymbol = `${cleanSymbol}-EQ`;

  let item = list.find(
    x =>
      x.exch_seg === "NSE" &&
      x.symbol === exactSymbol &&
      x.token
  );

  if (!item) {
    item = list.find(
      x =>
        x.exch_seg === "NSE" &&
        x.name === cleanSymbol &&
        x.symbol?.endsWith("-EQ") &&
        x.token
    );
  }

  if (!item) {
    item = list.find(
      x =>
        x.exch_seg === "NSE" &&
        (
          x.symbol === cleanSymbol ||
          x.symbol === exactSymbol ||
          x.name === cleanSymbol
        ) &&
        x.token
    );
  }

  if (!item) {
    throw new Error(`NSE token not found for ${cleanSymbol}`);
  }

  return {
    symbol: cleanSymbol,
    tradingSymbol: item.symbol,
    token: item.token,
    name: item.name
  };
}

async function getQuote(body = {}) {
  if (!jwtToken) {
    await login();
  }

  const inputSymbol = body.symbol || body.stock || "TCS";
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

  if (!item) {
    throw new Error("No quote data received");
  }

  return {
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
      rsi: 55,
      raw: item
    }
  };
}

module.exports = {
  login,
  getQuote,
  findNseToken
};
