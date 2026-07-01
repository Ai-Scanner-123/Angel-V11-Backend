const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { authenticator } = require('otplib');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

const PORT = process.env.PORT || 10000;
const BASE = 'https://apiconnect.angelone.in';

let session = { jwt: null, feedToken: null, refreshToken: null, createdAt: 0 };

const required = ['ANGEL_API_KEY','ANGEL_CLIENT_CODE','ANGEL_PIN','ANGEL_TOTP_SECRET'];
function checkEnv(){
  const missing = required.filter(k => !process.env[k]);
  if(missing.length) throw new Error('Missing env: ' + missing.join(', '));
}

function headers(jwt){
  return {
    'Content-Type':'application/json',
    'Accept':'application/json',
    'X-UserType':'USER',
    'X-SourceID':'WEB',
    'X-ClientLocalIP':process.env.CLIENT_LOCAL_IP || '127.0.0.1',
    'X-ClientPublicIP':process.env.CLIENT_PUBLIC_IP || '127.0.0.1',
    'X-MACAddress':process.env.CLIENT_MAC || '00:00:00:00:00:00',
    'X-PrivateKey':process.env.ANGEL_API_KEY,
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {})
  };
}

async function login(){
  checkEnv();
  const totp = authenticator.generate(process.env.ANGEL_TOTP_SECRET);
  const payload = {
    clientcode: process.env.ANGEL_CLIENT_CODE,
    password: process.env.ANGEL_PIN,
    totp
  };
  const res = await axios.post(`${BASE}/rest/auth/angelbroking/user/v1/loginByPassword`, payload, { headers: headers() });
  if(!res.data?.status) throw new Error(res.data?.message || 'Angel login failed');
  session.jwt = res.data.data.jwtToken;
  session.refreshToken = res.data.data.refreshToken;
  session.feedToken = res.data.data.feedToken;
  session.createdAt = Date.now();
  return session;
}

async function ensureLogin(){
  if(!session.jwt || Date.now() - session.createdAt > 8*60*60*1000) await login();
  return session.jwt;
}

async function angelPost(path, payload){
  let jwt = await ensureLogin();
  try {
    const res = await axios.post(`${BASE}${path}`, payload, { headers: headers(jwt), timeout: 15000 });
    if(!res.data?.status) throw new Error(res.data?.message || 'Angel API error');
    return res.data;
  } catch(e) {
    session.jwt = null;
    jwt = await ensureLogin();
    const res = await axios.post(`${BASE}${path}`, payload, { headers: headers(jwt), timeout: 15000 });
    if(!res.data?.status) throw new Error(res.data?.message || 'Angel API error');
    return res.data;
  }
}

const symbols = {
  TCS: '11536', RELIANCE:'2885', INFY:'1594', HDFCBANK:'1333', ICICIBANK:'4963', SBIN:'3045', ITC:'1660', LT:'11483', EXIDEIND:'676', WIPRO:'3787', TATAMOTORS:'3456', BHARTIARTL:'10604', AXISBANK:'5900', KOTAKBANK:'1922', BAJFINANCE:'317', MARUTI:'10999', ADANIENT:'25', ADANIPOWER:'17388', TATAPOWER:'3426', VEDL:'3063', RAILTEL:'2431'
};

app.get('/', (req,res)=>res.json({ ok:true, service:'Angel V11 Backend PRO', endpoints:['/health','/quote?symbol=TCS','/login-test'] }));
app.get('/health', (req,res)=>res.json({ ok:true, time:new Date().toISOString() }));

app.get('/login-test', async (req,res)=>{
  try { await login(); res.json({ ok:true, message:'Angel login success' }); }
  catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});

app.get('/quote', async (req,res)=>{
  try {
    const symbol = String(req.query.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const token = req.query.token || symbols[symbol];
    if(!symbol) return res.status(400).json({ ok:false, error:'symbol required' });
    if(!token) return res.status(400).json({ ok:false, error:`Token not found for ${symbol}. Add token in server.js symbols map.` });
    const payload = { mode:'FULL', exchangeTokens: { NSE:[String(token)] } };
    const data = await angelPost('/rest/secure/angelbroking/market/v1/quote/', payload);
    const item = data.data?.fetched?.[0];
    if(!item) return res.status(404).json({ ok:false, error:'No data fetched from Angel' });
    res.json({
      ok:true,
      symbol,
      token,
      price: item.ltp,
      previousClose: item.close,
      dayHigh: item.high,
      dayLow: item.low,
      open: item.open,
      volume: item.tradeVolume || item.volume,
      raw:item
    });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.listen(PORT, ()=> console.log(`Angel V11 backend running on ${PORT}`));
