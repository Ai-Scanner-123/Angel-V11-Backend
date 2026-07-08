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

function buildDecision(input = {}) {
  const symbol = input.symbol || "UNKNOWN";
  const price = num(input.price || input.ltp);
  const open = num(input.open, price);
  const high = num(input.high, price);
  const low = num(input.low, price);
  const volume = num(input.volume);
  const avgVolume = num(input.avgVolume || input.averageVolume, volume || 1);
  const vwap = num(input.vwap, price);
  const rsi = num(input.rsi, 50);
  const macd = num(input.macd, 0);
  const signal = num(input.macdSignal || input.signal, 0);
  const histogram = num(input.histogram || input.macdHistogram, macd - signal);
  const ema9 = num(input.ema9, price);
  const ema20 = num(input.ema20, price);
  const marketTrend = String(input.marketTrend || "neutral").toLowerCase();

  const range = Math.max(high - low, price * 0.006);
  const rvol = avgVolume > 0 ? volume / avgVolume : 1;
  const dayPos = range > 0 ? ((price - low) / range) * 100 : 50;

  let score = 50;
  const reasons = [];
  const warnings = [];

  // ===== VWAP Logic =====
  const vwapBullish = price > vwap;
  const vwapBearish = price < vwap;

  if (vwapBullish) {
    score += 10;
    reasons.push("Price VWAP ke upar hai");
  } else if (vwapBearish) {
    score -= 10;
    warnings.push("Price VWAP ke neeche hai");
  }

  // ===== EMA Trend Logic =====
  const emaBullish = price > ema9 && ema9 > ema20;
  const emaBearish = price < ema9 && ema9 < ema20;

  if (emaBullish) {
    score += 18;
    reasons.push("EMA trend bullish hai: Price > EMA9 > EMA20");
  } else if (emaBearish) {
    score -= 18;
    warnings.push("EMA trend bearish hai: Price < EMA9 < EMA20");
  } else {
    warnings.push("EMA trend clear nahi hai");
  }

  // ===== RSI Logic =====
  const rsiBullish = rsi > 55;
  const rsiBearish = rsi < 45;

  if (rsi >= 55 && rsi <= 65) {
    score += 14;
    reasons.push("RSI bullish momentum zone me hai");
  } else if (rsi >= 35 && rsi <= 45) {
    score -= 14;
    warnings.push("RSI bearish momentum zone me hai");
  } else if (rsi > 65 && rsi <= 72) {
    score += 5;
    warnings.push("RSI high hai - fresh entry me confirmation zaruri");
  } else if (rsi >= 28 && rsi < 35) {
    score -= 5;
    warnings.push("RSI low hai - fresh sell me confirmation zaruri");
  } else if (rsi > 72) {
    score -= 20;
    warnings.push("RSI overbought hai - fresh buy avoid kare");
  } else if (rsi < 28) {
    score += 4;
    warnings.push("RSI oversold hai - fresh sell avoid kare, bounce aa sakta hai");
  } else {
    warnings.push("RSI neutral zone me hai");
  }

  // ===== MACD 12,26,9 Intraday Logic =====
  const macdBullish = macd > signal;
  const macdBearish = macd < signal;
  const histBullish = histogram > 0;
  const histBearish = histogram < 0;
  const macdGap = Math.abs(macd - signal);
  const flatMacd = macdGap < Math.max(price * 0.00015, 0.03);

  if (macdBullish && histBullish && !flatMacd) {
    score += 18;
    reasons.push("MACD bullish confirmation: MACD > Signal aur Histogram positive");
  } else if (macdBearish && histBearish && !flatMacd) {
    score -= 18;
    warnings.push("MACD bearish confirmation: MACD < Signal aur Histogram negative");
  } else if (flatMacd) {
    warnings.push("MACD aur Signal bahut paas hain - wait better");
  } else {
    warnings.push("MACD confirmation clear nahi hai");
  }

  // Fake signal filter: EMA aur MACD opposite ho to confidence reduce.
  if (emaBullish && (macdBearish || histBearish)) {
    score -= 15;
    warnings.push("EMA bullish hai lekin MACD support nahi kar raha - BUY avoid/confirm kare");
  }

  if (emaBearish && (macdBullish || histBullish)) {
    score += 15;
    warnings.push("EMA bearish hai lekin MACD support nahi kar raha - SELL avoid/confirm kare");
  }

  // ===== Relative Volume Logic =====
  const volumeStrong = rvol >= 1.5;
  const volumeLow = rvol < 0.8;

  if (volumeStrong) {
    score += 12;
    reasons.push("Relative volume strong hai");
  } else if (volumeLow) {
    score -= 12;
    warnings.push("Volume low hai - fake move ka risk");
  } else {
    reasons.push("Volume normal hai");
  }

  // ===== Intraday Open Position =====
  if (price > open) {
    score += 6;
    reasons.push("Stock intraday positive hai");
  } else if (price < open) {
    score -= 6;
    warnings.push("Stock intraday negative hai");
  }

  // ===== Market Trend Logic =====
  if (marketTrend === "bullish") {
    score += 8;
    reasons.push("Market trend bullish hai");
  } else if (marketTrend === "bearish") {
    score -= 8;
    warnings.push("Market trend bearish hai");
  } else {
    warnings.push("Market trend neutral/sideways hai");
  }

  // ===== Extreme Range Filter =====
  if (dayPos >= 85) {
    score -= 6;
    warnings.push("Price day high ke bahut paas hai - chase na kare");
  }

  if (dayPos <= 15) {
    score += 6;
    warnings.push("Price day low ke bahut paas hai - fresh sell me caution");
  }

  score = clamp(Math.round(score), 0, 100);

  // ===== Professional Intraday Decision =====
  const strongBuySetup =
    emaBullish &&
    vwapBullish &&
    rsiBullish &&
    macdBullish &&
    histBullish &&
    volumeStrong;

  const strongSellSetup =
    emaBearish &&
    vwapBearish &&
    rsiBearish &&
    macdBearish &&
    histBearish &&
    !volumeLow;

  let decision = "WAIT";
  if (score >= 82 && strongBuySetup) decision = "STRONG BUY";
  else if (score >= 65 && emaBullish && macdBullish && histBullish && rsi >= 50) decision = "BUY";
  else if (score <= 28 && strongSellSetup) decision = "STRONG SELL";
  else if (score <= 42 && emaBearish && macdBearish && histBearish && rsi <= 50) decision = "SELL";

  const risk =
    decision === "STRONG BUY" || decision === "STRONG SELL"
      ? "LOW"
      : decision === "BUY" || decision === "SELL"
      ? "MEDIUM"
      : "HIGH";

  const isSell = decision === "SELL" || decision === "STRONG SELL";
  const isBuy = decision === "BUY" || decision === "STRONG BUY";

  const slGap = Math.max(range * 0.6, price * 0.004);
  const entryLow = isBuy ? price - price * 0.002 : price;
  const entryHigh = isBuy ? price + price * 0.001 : price;

  const stopLoss = isSell ? price + slGap : price - slGap;
  const target1 = isSell ? price - slGap * 1.5 : price + slGap * 1.5;
  const target2 = isSell ? price - slGap * 2.2 : price + slGap * 2.2;
  const target3 = isSell ? price - slGap * 3 : price + slGap * 3;

  const macdStatus =
    macdBullish && histBullish
      ? "Bullish Momentum"
      : macdBearish && histBearish
      ? "Bearish Momentum"
      : "Neutral / Weak";

  return {
    symbol,
    decision,
    confidence: score,
    tradeScore: score,
    risk,
    price: round(price),
    ema9: round(ema9),
    ema20: round(ema20),
    macd: round(macd),
    signal: round(signal),
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
    dayPosition: round(dayPos, 1),
    confirmations: {
      emaBullish,
      emaBearish,
      rsiBullish,
      rsiBearish,
      macdBullish,
      macdBearish,
      histBullish,
      histBearish,
      vwapBullish,
      vwapBearish,
      volumeStrong,
      volumeLow
    },
    reasons,
    warnings,
    finalMessage:
      decision === "STRONG BUY"
        ? "Strong BUY setup hai. Entry, SL aur risk limit strictly follow kare."
        : decision === "BUY"
        ? "BUY possible hai, lekin confirmation aur stop loss follow kare."
        : decision === "STRONG SELL"
        ? "Strong SELL setup hai. Breakdown confirmation aur risk control zaruri hai."
        : decision === "SELL"
        ? "SELL pressure hai, risk control ke saath trade kare."
        : "WAIT kare. EMA + RSI + MACD confirmation strong nahi hai."
  };
}

module.exports = {
  buildDecision
};
