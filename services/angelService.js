async function login() {
  return {
    success: true,
    message: "Angel service ready"
  };
}

async function getQuote(body = {}) {
  const symbol = body.symbol || "TCS";

  return {
    success: true,
    data: {
      symbol: symbol,
      ltp: 100,
      price: 100,
      previousClose: 99,
      high: 102,
      low: 98,
      rsi: 55
    }
  };
}

module.exports = {
  login,
  getQuote
};
