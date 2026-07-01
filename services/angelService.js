const axios = require('axios');
const speakeasy = require('speakeasy');

const BASE_URL = process.env.ANGEL_BASE_URL || 'https://apiconnect.angelone.in';

let cachedSession = {
  jwtToken: null,
  refreshToken: null,
  feedToken: null,
  expiresAt: 0
};

function getHeaders(jwtToken) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': process.env.CLIENT_LOCAL_IP || '127.0.0.1',
    'X-ClientPublicIP': process.env.CLIENT_PUBLIC_IP || '127.0.0.1',
    'X-MACAddress': process.env.CLIENT_MAC_ADDRESS || '00:00:00:00:00:00',
    'X-PrivateKey': process.env.ANGEL_API_KEY,
    ...(jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {})
  };
}

function generateTotp() {
  if (!process.env.ANGEL_TOTP_SECRET) {
    throw new Error('ANGEL_TOTP_SECRET missing in environment variables');
  }

  return speakeasy.totp({
    secret: process.env.ANGEL_TOTP_SECRET,
    encoding: 'base32',
    step: 30
  });
}

async function login() {
  const required = ['ANGEL_API_KEY', 'ANGEL_CLIENT_CODE', 'ANGEL_PASSWORD', 'ANGEL_TOTP_SECRET'];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`${key} missing in environment variables`);
  }

  const payload = {
    clientcode: process.env.ANGEL_CLIENT_CODE,
    password: process.env.ANGEL_PASSWORD,
    totp: generateTotp()
  };

  const url = `${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`;
  const response = await axios.post(url, payload, { headers: getHeaders() });

  if (!response.data || response.data.status === false) {
    throw new Error(response.data?.message || 'Angel login failed');
  }

  const data = response.data.data || {};
  cachedSession = {
    jwtToken: data.jwtToken,
    refreshToken: data.refreshToken,
    feedToken: data.feedToken,
    expiresAt: Date.now() + 20 * 60 * 1000
  };

  return cachedSession;
}

async function getSession() {
  if (cachedSession.jwtToken && Date.now() < cachedSession.expiresAt) {
    return cachedSession;
  }
  return login();
}

async function getQuote({ exchange = 'NSE', symboltoken, tradingsymbol }) {
  if (!symboltoken) throw new Error('symboltoken is required');

  const session = await getSession();
  const url = `${BASE_URL}/rest/secure/angelbroking/market/v1/quote/`;

  const payload = {
    mode: 'FULL',
    exchangeTokens: {
      [exchange]: [String(symboltoken)]
    }
  };

  const response = await axios.post(url, payload, { headers: getHeaders(session.jwtToken) });

  if (!response.data || response.data.status === false) {
    throw new Error(response.data?.message || 'Angel quote failed');
  }

  const fetched = response.data.data?.fetched?.[0] || null;
  return {
    tradingsymbol: tradingsymbol || fetched?.tradingSymbol || null,
    exchange,
    symboltoken,
    raw: fetched
  };
}

function simpleSignalFromQuote(quote) {
  const q = quote.raw || {};
  const ltp = Number(q.ltp || q.lastTradedPrice || 0);
  const open = Number(q.open || 0);
  const high = Number(q.high || 0);
  const low = Number(q.low || 0);

  let signal = 'WATCH';
  let reason = 'Data received, wait for confirmation';

  if (ltp && open && high && low) {
    if (ltp > open && ltp > (low + (high - low) * 0.65)) {
      signal = 'BUY WATCH';
      reason = 'Price is above open and near upper intraday range';
    } else if (ltp < open && ltp < (low + (high - low) * 0.35)) {
      signal = 'SELL WATCH';
      reason = 'Price is below open and near lower intraday range';
    }
  }

  return { signal, reason, ltp, open, high, low };
}

module.exports = {
  login,
  getSession,
  getQuote,
  simpleSignalFromQuote
};
