function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round(n, d = 2) {
  return Number(num(n).toFixed(d));
}

function addReason(list, text) {
  if (text && !list.includes(text)) list.push(text);
}

function buildDecision(input = {}) {
  const symbol = String(input.symbol || "UNKNOWN").toUpperCase();

  const price = num(input.price || input.ltp);
  const open = num(input.open, price);
  const high = num(input.high, price);
  const low = num(input.low, price);
  const prevClose = num(input.previousClose || input.prevClose || input.close, price);

  const volume = num(input.volume);
  const avgVolume = num(input.avgVolume || input.averageVolume, volume || 1);
  const vwap = num(input.vwap, price);

  const rsi = num(input.rsi, 50);
  const ema9 = num(input.ema9, price);
  const ema20 = num(input.ema20, price);

  const macd = num(input.macd, 0);
  const signalLine = num(input.macdSignal || input.signal, 0);
  const histogram = num(input.histogram || input.macdHistogram, macd - signalLine);

  const marketTrend = String(input.marketTrend || input.trend || "neutral").toLowerCase();

  const range = Math.max(high - low, price * 0.006);
  const rvol = avgVolume > 0 ? volume / avgVolume : 1;
  const dayPosition = range > 0 ? ((price - low) / range) * 100 : 50;
  const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

  const reasons = [];
  const warnings = [];

  const bullish = {
    priceAboveEma9: price > ema9,
    emaTrend: price > ema9 && ema9 > ema20,
    rsi: rsi > 55,
    macd: macd > signalLine && histogram > 0,
    prevClose: price > prevClose,
    vwap: price > vwap,
    volume: rvol >= 1.2 || volume === 0,
    market: marketTrend === "bullish" || marketTrend === "up" || marketTrend === "neutral"
  };

  const bearish = {
    priceBelowEma9: price < ema9,
    emaTrend: price < ema9 && ema9 < ema20,
    rsi: rsi < 45,
    macd: macd < signalLine && histogram < 0,
    prevClose: price < prevClose,
    vwap: price < vwap,
    volume: rvol >= 1.2 || volume === 0,
    market: marketTrend === "bearish" || marketTrend === "down" || marketTrend === "neutral"
  };

  let buyConfirm = 0;
  let sellConfirm = 0;

  Object.values(bullish).forEach(v => { if (v) buyConfirm++; });
  Object.values(bearish).forEach(v => { if (v) sellConfirm++; });

  // ===== Reasons / warnings =====
  if (bullish.priceAboveEma9) addReason(reasons, "Price EMA 9 ke upar hai");
  else addReason(warnings, "Price EMA 9 ke neeche hai");

  if (bullish.emaTrend) addReason(reasons, "EMA trend bullish hai: Price > EMA9 > EMA20");
  else if (bearish.emaTrend) addReason(warnings, "EMA trend bearish hai: Price < EMA9 < EMA20");
  else addReason(warnings, "EMA trend clear nahi hai - wait better");

  if (rsi > 55) addReason(reasons, "RSI bullish zone me hai");
  else if (rsi < 45) addReason(warnings, "RSI bearish/sell zone me hai");
  else addReason(warnings, "RSI neutral hai - confirmation chahiye");

  if (bullish.macd) addReason(reasons, "MACD bullish: MACD > Signal aur Histogram positive");
  else if (bearish.macd) addReason(warnings, "MACD bearish: MACD < Signal aur Histogram negative");
  else addReason(warnings, "MACD clear confirmation nahi de raha");

  if (price > prevClose) addReason(reasons, "Stock previous close se upar hai");
  else if (price < prevClose) addReason(warnings, "Stock previous close se neeche hai");

  if (price > vwap) addReason(reasons, "Price VWAP ke upar hai");
  else addReason(warnings, "Price VWAP ke neeche hai");

  if (rvol >= 1.5) addReason(reasons, "High RVOL: move strong hai");
  else if (rvol >= 1.2) addReason(reasons, "Volume supportive hai");
  else if (volume > 0 && rvol < 0.8) addReason(warnings, "Low RVOL: trade avoid better");

  if (marketTrend === "bullish" || marketTrend === "up") addReason(reasons, "Market bullish hai");
  else if (marketTrend === "bearish" || marketTrend === "down") addReason(warnings, "Market bearish hai");

  if (Math.abs(changePct) >= 3) {
    addReason(warnings, "Big move already ho chuka hai - chase avoid kare");
  }

  if (dayPosition <= 20) {
    addReason(warnings, "Stock day low ke paas hai - BUY me confirmation zaruri");
  }
  if (dayPosition >= 80) {
    addReason(warnings, "Stock day high ke paas hai - fresh BUY me saavdhani");
  }

  // ===== Strict Intraday Decision =====
  let decision = "WAIT";
  let confidence = 50;

  if (buyConfirm >= 7 && bullish.emaTrend && bullish.rsi && bullish.macd && bullish.prevClose) {
    decision = "STRONG BUY";
    confidence = 88 + Math.min(7, buyConfirm - 7);
  } else if (sellConfirm >= 7 && bearish.emaTrend && bearish.rsi && bearish.macd && bearish.prevClose) {
    decision = "STRONG SELL";
    confidence = 88 + Math.min(7, sellConfirm - 7);
  } else if (buyConfirm >= 6 && bullish.macd && bullish.priceAboveEma9 && rsi >= 50 && !bearish.emaTrend) {
    decision = "BUY";
    confidence = 68 + (buyConfirm - 6) * 6;
  } else if (sellConfirm >= 6 && bearish.macd && bearish.priceBelowEma9 && rsi <= 50 && !bullish.emaTrend) {
    decision = "SELL";
    confidence = 68 + (sellConfirm - 6) * 6;
  } else {
    decision = "WAIT";
    const best = Math.max(buyConfirm, sellConfirm);
    confidence = 42 + best * 4;
    addReason(warnings, "Mixed signal hai - BUY/SELL jaldi nahi karna");
  }

  // Extra contradiction filters.
  if ((decision === "BUY" || decision === "STRONG BUY") && (rsi < 50 || bearish.emaTrend || price < prevClose)) {
    decision = "WAIT";
    confidence = Math.min(confidence, 62);
    addReason(warnings, "BUY contradiction: RSI/EMA/Previous Close confirm nahi kar rahe");
  }

  if ((decision === "SELL" || decision === "STRONG SELL") && (rsi > 50 || bullish.emaTrend || price > prevClose)) {
    decision = "WAIT";
    confidence = Math.min(confidence, 62);
    addReason(warnings, "SELL contradiction: RSI/EMA/Previous Close confirm nahi kar rahe");
  }

  confidence = clamp(Math.round(confidence), 0, 95);

  const risk = confidence >= 85 ? "LOW" : confidence >= 68 ? "MEDIUM" : "HIGH";

  const slGap = Math.max(range * 0.28, price * 0.004);
  const isSell = decision === "SELL" || decision === "STRONG SELL";
  const isBuy = decision === "BUY" || decision === "STRONG BUY";

  const entryLow = isBuy ? price - price * 0.002 : price;
  const entryHigh = isBuy ? price + price * 0.001 : price;

  const stopLoss = isSell ? price + slGap : price - slGap;
  const target1 = isSell ? price - slGap * 1.5 : price + slGap * 1.5;
  const target2 = isSell ? price - slGap * 2.2 : price + slGap * 2.2;
  const target3 = isSell ? price - slGap * 3 : price + slGap * 3;

  const macdStatus = bullish.macd
    ? "BULLISH MOMENTUM"
    : bearish.macd
    ? "BEARISH MOMENTUM"
    : "NEUTRAL / WAIT";

  return {
    symbol,
    decision,
    confidence,
    tradeScore: confidence,
    buyConfirm,
    sellConfirm,
    risk,
    price: round(price),
    previousClose: round(prevClose),
    changePct: round(changePct, 2),
    dayPosition: round(dayPosition, 1),
    ema9: round(ema9),
    ema20: round(ema20),
    macd: round(macd),
    signal: round(signalLine),
    histogram: round(histogram),
    macdStatus,
    entryZone: {
      low: round(entryLow),
      high: round(entryHigh)
    },
    stopLoss: round(stopLoss),
    targets: {
      t1: round(target1),
      t2: round(target2),
      t3: round(target3)
    },
    rvol: round(rvol, 2),
    reasons,
    warnings,
    finalMessage:
      decision === "STRONG BUY" || decision === "BUY"
        ? "BUY possible hai, lekin sirf confirmation ke saath entry kare. Stop loss follow kare."
        : decision === "STRONG SELL" || decision === "SELL"
        ? "SELL pressure hai, lekin confirmation aur risk control ke saath trade kare."
        : "WAIT kare. Signal mixed hai ya confirmation complete nahi hai."
  };
}

module.exports = {
  buildDecision
};
