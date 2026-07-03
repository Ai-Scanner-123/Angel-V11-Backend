const axios = require("axios");
const speakeasy = require("speakeasy");

let jwtToken = null;

const BASE_URL = "https://apiconnect.angelbroking.com";

const tokenMap = {
  TCS: "11536",
  WIPRO: "3787",
  EXIDEIND: "676",
  SBIN: "3045",
  RELIANCE: "2885"
};

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

async function getQuote(body = {}) {
  if (!jwtToken) {
    await login();
  }

  const symbol = String(body.symbol || "TCS").toUpperCase();
  const symbolToken = tokenMap[symbol];

  if (!symbolToken) {
    throw new Error(`Token not found for ${symbol}`);
  }

  const payload = {
    mode: "FULL",
    exchangeTokens: {
      NSE: [symbolToken]
    }
  };

  const res = await axios.post(
    `${BASE_URL}/rest/secure/angelbroking/market/v1/quote/`,
    payload,
    { headers: getHeaders() }
  );

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
      symbol,
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
  getQuote
};
