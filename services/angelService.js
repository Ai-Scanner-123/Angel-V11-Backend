const { SmartAPI } = require("smartapi-javascript");

let smartApi = null;
let loggedIn = false;

function getSmartApi() {
  if (!smartApi) {
    smartApi = new SmartAPI({
      api_key: process.env.ANGEL_API_KEY
    });
  }
  return smartApi;
}

async function login() {
  const api = getSmartApi();

  const data = await api.generateSession(
    process.env.ANGEL_CLIENT_CODE,
    process.env.ANGEL_PASSWORD,
    process.env.ANGEL_TOTP_SECRET
  );

  loggedIn = true;

  return {
    success: true,
    message: "Angel One SmartAPI login successful",
    data
  };
}

async function getQuote(body = {}) {
  if (!loggedIn) {
    await login();
  }

  const symbol = String(body.symbol || "TCS").toUpperCase();

  // अभी test के लिए TCS token
  const tokenMap = {
    TCS: "11536",
    WIPRO: "3787",
    EXIDEIND: "676",
    SBIN: "3045",
    RELIANCE: "2885"
  };

  const symbolToken = tokenMap[symbol];

  if (!symbolToken) {
    throw new Error("Symbol token not found. Please add token for " + symbol);
  }

  const api = getSmartApi();

  const result = await api.getMarketData({
    mode: "FULL",
    exchangeTokens: {
      NSE: [symbolToken]
    }
  });

  const item = result?.data?.fetched?.[0] || {};

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
