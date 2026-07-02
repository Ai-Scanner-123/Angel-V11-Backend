function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 2) {
  const p = Math.pow(10, decimals);
  return Math.round(value * p) / p;
}

function scoreRSI(rsi, side) {
  rsi = toNumber(rsi, 50);
  if (side === 'BUY') {
    if (rsi >= 45 && rsi <= 68) return 90;
    if (rsi > 68 && rsi <= 75) return 70;
    if (rsi < 45 && rsi >= 35) return 55;
    return 35;
  }
  if (rsi >= 32 && rsi <= 55) return 90;
  if (rsi < 32 && rsi >= 25) return 70;
  if (rsi > 55 && rsi <= 65) return 55;
  return 35;
}

function getMarketScore(market = {}) {
  let score = 50;
  const nifty = String(market.niftyTrend || '').toLowerCase();
  const banknifty = String(market.bankniftyTrend || '').toLowerCase();
  const vix = toNumber(market.vix, 14);
  const breadth = toNumber(market.breadth, 50);

  if (nifty.includes('bull')) score += 15;
  if (nifty.includes('bear')) score -= 15;
  if (banknifty.includes('bull')) score += 10;
  if (banknifty.includes('bear')) score -= 10;
  if (vix <= 14) score += 8;
  else if (vix <= 18) score += 2;
  else if (vix >= 22) score -= 12;
  if (breadth >= 60) score += 10;
  else if (breadth <= 40) score -= 10;

  return clamp(score);
}

function makeDecision(input = {}) {
  const symbol = input.symbol || 'STOCK';
  const price = toNumber(input.price || input.ltp, 0);
  const open = toNumber(input.open, price);
  const high = toNumber(input.high, price);
  const low = toNumber(input.low, price);
  const vwap = toNumber(input.vwap, price);
  const rsi = toNumber(input.rsi, 50);
  const rvol = toNumber(input.rvol || input.relativeVolume, 1);
  const macd = String(input.macd || '').toLowerCase();
  const trend = String(input.trend || '').toLowerCase();
  const volume = toNumber(input.volume, 0);
  const avgVolume = toNumber(input.avgVolume, volume || 1);
  const atr = toNumber(input.atr, Math.max((high - low) || price * 0.006, price * 0.004));
  const marketScore = getMarketScore(input.market || {});

  let buyScore = 0;
  let sellScore = 0;
  const buyReasons = [];
  const sellReasons = [];
  const warnings = [];

  if (price > vwap) { buyScore += 18; buyReasons.push('Price VWAP ke upar hai'); }
  if (price < vwap) { sellScore += 18; sellReasons.push('Price VWAP ke neeche hai'); }

  if (trend.includes('bull') || trend.includes('up')) { buyScore += 18; buyReasons.push('Trend bullish hai'); }
  if (trend.includes('bear') || trend.includes('down')) { sellScore += 18; sellReasons.push('Trend bearish hai'); }

  if (macd.includes('bull') || macd.includes('positive')) { buyScore += 12; buyReasons.push('MACD bullish signal de raha hai'); }
  if (macd.includes('bear') || macd.includes('negative')) { sellScore += 12; sellReasons.push('MACD bearish signal de raha hai'); }

  if (rvol >= 1.5 || volume > avgVolume * 1.5) { buyScore += 14; sellScore += 14; buyReasons.push('Relative volume strong hai'); sellReasons.push('Relative volume strong hai'); }
  else if (rvol < 0.8) { warnings.push('Low RVOL - volume weak hai'); }

  if (price > open) { buyScore += 8; buyReasons.push('Price opening se upar sustain kar raha hai'); }
  if (price < open) { sellScore += 8; sellReasons.push('Price opening se neeche sustain kar raha hai'); }

  buyScore += scoreRSI(rsi, 'BUY') * 0.18;
  sellScore += scoreRSI(rsi, 'SELL') * 0.18;

  if (marketScore >= 65) { buyScore += 12; buyReasons.push('Overall market supportive hai'); }
  if (marketScore <= 35) { sellScore += 12; sellReasons.push('Overall market weak hai'); }
  if (marketScore > 35 && marketScore < 65) warnings.push('Market neutral/sideways hai');

  const side = buyScore > sellScore ? 'BUY' : sellScore > buyScore ? 'SELL' : 'WAIT';
  const rawScore = Math.max(buyScore, sellScore);
  const tradeScore = clamp(Math.round(rawScore));
  const confidence = clamp(Math.round((tradeScore * 0.75) + (marketScore * 0.25)));

  let decision = side;
  let reasons = side === 'BUY' ? buyReasons : sellReasons;

  if (tradeScore < 70 || confidence < 65 || warnings.length >= 2) {
    decision = 'WAIT';
    reasons = ['Trade quality abhi strong nahi hai', ...warnings];
  }

  const risk = confidence >= 85 && warnings.length === 0 ? 'LOW' : confidence >= 70 ? 'MEDIUM' : 'HIGH';
  const slDistance = Math.max(atr * 1.2, price * 0.004);

  let entryLow, entryHigh, stopLoss, targets;
  if (decision === 'SELL') {
    entryLow = price - atr * 0.15;
    entryHigh = price + atr * 0.10;
    stopLoss = price + slDistance;
    targets = [price - slDistance * 1.2, price - slDistance * 2, price - slDistance * 3];
  } else {
    entryLow = price - atr * 0.10;
    entryHigh = price + atr * 0.15;
    stopLoss = price - slDistance;
    targets = [price + slDistance * 1.2, price + slDistance * 2, price + slDistance * 3];
  }

  return {
    success: true,
    version: '11.1.0',
    symbol,
    decision,
    confidence,
    tradeScore,
    marketScore,
    risk,
    entryZone: {
      low: round(entryLow),
      high: round(entryHigh)
    },
    stopLoss: round(stopLoss),
    targets: targets.map(t => round(t)),
    riskReward: '1 : 2+',
    reasons: reasons.slice(0, 8),
    warnings,
    raw: {
      buyScore: round(buyScore),
      sellScore: round(sellScore),
      rsi,
      rvol,
      vwap,
      atr: round(atr)
    }
  };
}

module.exports = { makeDecision };
