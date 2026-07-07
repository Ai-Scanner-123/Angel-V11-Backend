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
  const ema20 = num(input.ema20, price);
  const ema50 = num(input.ema50, price);
  const marketTrend = String(input.marketTrend || "neutral").toLowerCase();

  const range = Math.max(high - low, price * 0.006);
  const rvol = avgVolume > 0 ? volume / avgVolume : 1;

  let score = 50;
  const reasons = [];
  const warnings = [];

  if (price > vwap) {
    score += 10;
    reasons.push("Price VWAP ke upar hai");
  } else {
    score -= 10;
    warnings.push("Price VWAP ke neeche hai");
  }

  if (ema20 > ema50 && price > ema20) {
    score += 15;
    reasons.push("Trend strong hai");
  } else if (ema20 < ema50 && price < ema20) {
    score -= 15;
    warnings.push("Trend weak hai");
  }

 // ===== RSI Logic V11.3 =====
if (rsi >= 50 && rsi <= 62) {
    score += 14;
    reasons.push("RSI bullish zone me hai");
}
else if (rsi >= 38 && rsi <= 48) {
    score -= 14;
    warnings.push("RSI bearish zone me hai");
}
else if (rsi > 62 && rsi <= 70) {
    score += 5;
    warnings.push("RSI high hai - confirmation ka wait kare");
}
else if (rsi >= 30 && rsi < 38) {
    score -= 5;
    warnings.push("RSI low hai - confirmation ka wait kare");
}
else if (rsi > 70) {
    score -= 20;
    warnings.push("RSI overbought hai - fresh buy avoid kare");
}
else if (rsi < 30) {
    score -= 20;
    warnings.push("RSI oversold hai - fresh sell avoid kare");
}
else {
    warnings.push("RSI neutral hai");
}

  if (macd > signal) {
    score += 10;
    reasons.push("MACD bullish hai");
  } else {
    score -= 10;
    warnings.push("MACD weak hai");
  }

  if (rvol >= 1.5) {
    score += 12;
    reasons.push("Relative volume strong hai");
  } else if (rvol < 0.8) {
    score -= 12;
    warnings.push("Volume low hai");
  }

  if (price > open) {
    score += 6;
    reasons.push("Stock intraday positive hai");
  } else {
    score -= 6;
    warnings.push("Stock intraday negative hai");
  }

  if (marketTrend === "bullish") {
    score += 8;
    reasons.push("Market trend bullish hai");
  } else if (marketTrend === "bearish") {
    score -= 8;
    warnings.push("Market trend bearish hai");
  }

  score = clamp(score, 0, 100);

  let decision = "WAIT";
  if (score >= 80) decision = "BUY";
  if (score <= 30) decision = "SELL";

  const risk = score >= 80 ? "LOW" : score >= 60 ? "MEDIUM" : "HIGH";

  const slGap = Math.max(range * 0.6, price * 0.004);
  const entryLow = decision === "BUY" ? price - price * 0.002 : price;
  const entryHigh = decision === "BUY" ? price + price * 0.001 : price;

  const stopLoss =
    decision === "BUY"
      ? price - slGap
      : decision === "SELL"
      ? price + slGap
      : price - slGap;

  const target1 =
    decision === "SELL" ? price - slGap * 1.5 : price + slGap * 1.5;
  const target2 =
    decision === "SELL" ? price - slGap * 2.2 : price + slGap * 2.2;
  const target3 =
    decision === "SELL" ? price - slGap * 3 : price + slGap * 3;

  return {
    symbol,
    decision,
    confidence: score,
    tradeScore: score,
    risk,
    price: round(price),
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
      decision === "BUY"
        ? "BUY possible hai, lekin entry zone aur stop loss follow kare."
        : decision === "SELL"
        ? "SELL pressure hai, risk control ke saath trade kare."
        : "WAIT kare. Trade quality strong nahi hai."
  };
}

module.exports = {
  buildDecision
};
