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
  const prev = num(input.previousClose || input.prevClose || input.close, price);
  const open = num(input.open, price);
  const high = num(input.high, price);
  const low = num(input.low, price);
  const volume = num(input.volume);
  const avgVolume = num(input.avgVolume || input.averageVolume, 0);
  const vwap = num(input.vwap, price);
  const rsi = num(input.rsi, 50);
  const ema9 = num(input.ema9, price);
  const ema20 = num(input.ema20, price);
  const macd = num(input.macd, 0);
  const signal = num(input.macdSignal || input.signal, 0);
  const histogram = num(input.histogram, macd - signal);
  const marketTrend = String(input.marketTrend || input.trend || "neutral").toLowerCase();

  const range = Math.max(high - low, price * 0.006);
  const rvol = avgVolume > 0 ? volume / avgVolume : 1;
  const pos = range > 0 ? ((price - low) / range) * 100 : 50;
  const changePct = prev > 0 ? ((price - prev) / prev) * 100 : 0;

  const reasons = [];
  const warnings = [];

  let buyScore = 0;
  let sellScore = 0;
  let buyConfirmations = 0;
  let sellConfirmations = 0;

  function buy(ok, weight, text) {
    if (ok) {
      buyConfirmations += 1;
      buyScore += weight;
      reasons.push("✔ " + text);
    }
  }

  function sell(ok, weight, text) {
    if (ok) {
      sellConfirmations += 1;
      sellScore += weight;
      reasons.push("✔ " + text);
    }
  }

  // ===== Core directional confirmations =====
  buy(price > ema9, 14, "Price EMA 9 ke upar hai");
  sell(price < ema9, 14, "Price EMA 9 ke neeche hai");

  buy(ema9 > ema20, 18, "EMA trend bullish hai: EMA 9 > EMA 20");
  sell(ema9 < ema20, 18, "EMA trend bearish hai: EMA 9 < EMA 20");

  buy(rsi > 55, 14, "RSI 55 ke upar bullish confirmation de raha hai");
  sell(rsi < 45, 14, "RSI 45 ke neeche bearish confirmation de raha hai");

  buy(macd > signal, 12, "MACD Signal line ke upar hai");
  sell(macd < signal, 12, "MACD Signal line ke neeche hai");

  buy(histogram > 0, 10, "Histogram positive hai");
  sell(histogram < 0, 10, "Histogram negative hai");

  buy(price > prev, 10, "Price previous close ke upar hai");
  sell(price < prev, 10, "Price previous close ke neeche hai");

  // VWAP is useful only if backend sends real VWAP. If missing, vwap == price, so no side gets point.
  buy(vwap && vwap !== price && price > vwap, 8, "Price VWAP ke upar hai");
  sell(vwap && vwap !== price && price < vwap, 8, "Price VWAP ke neeche hai");

  // ===== Supportive filters: add score only to the current stronger side, not both =====
  const strongVolume = rvol >= 1.2 || (avgVolume === 0 && volume > 0);
  if (strongVolume) {
    if (buyScore > sellScore) buyScore += 6;
    else if (sellScore > buyScore) sellScore += 6;
    reasons.push("✔ Volume/RVOL supportive hai");
  } else if (avgVolume > 0 && rvol < 0.8) {
    warnings.push("⚠ Volume low hai - signal weak ho sakta hai");
    buyScore -= 5;
    sellScore -= 5;
  }

  if (marketTrend === "bullish") {
    buyScore += 7;
    reasons.push("✔ Market trend bullish hai");
  } else if (marketTrend === "bearish") {
    sellScore += 7;
    reasons.push("✔ Market trend bearish hai");
  } else {
    warnings.push("⚠ Market trend neutral/sideways hai");
  }

  if (price > open) {
    buyScore += 4;
  } else if (price < open) {
    sellScore += 4;
  }

  // ===== Intraday safety filters =====
  if (pos >= 80) {
    warnings.push("⚠ Price day high ke paas hai - fresh buy me chase avoid kare");
    buyScore -= 8;
  }
  if (pos <= 20) {
    warnings.push("⚠ Price day low ke paas hai - fresh sell me confirmation zaroori");
    sellScore -= 8;
  }
  if (rsi > 70) {
    warnings.push("⚠ RSI overbought hai - fresh buy avoid kare");
    buyScore -= 12;
  }
  if (rsi < 30) {
    warnings.push("⚠ RSI oversold hai - fresh sell avoid kare");
    sellScore -= 12;
  }
  if (Math.abs(changePct) > 3) {
    warnings.push("⚠ Big move already ho chuka hai - chase na kare");
    buyScore -= 6;
    sellScore -= 6;
  }

  buyScore = clamp(Math.round(buyScore), 0, 100);
  sellScore = clamp(Math.round(sellScore), 0, 100);

  let decision = "WAIT / CONFIRMATION";
  let side = "wait";

  const scoreGap = Math.abs(buyScore - sellScore);

  if (buyScore >= 72 && buyConfirmations >= 5 && scoreGap >= 18) {
    decision = buyScore >= 86 && buyConfirmations >= 6 ? "STRONG BUY" : "BUY";
    side = "buy";
  } else if (sellScore >= 72 && sellConfirmations >= 5 && scoreGap >= 18) {
    decision = sellScore >= 86 && sellConfirmations >= 6 ? "STRONG SELL" : "SELL";
    side = "sell";
  }

  // If major indicators are not aligned, do not allow BUY/SELL.
  const bullishAlignment = price > ema9 && ema9 > ema20 && rsi > 55 && macd > signal && histogram > 0;
  const bearishAlignment = price < ema9 && ema9 < ema20 && rsi < 45 && macd < signal && histogram < 0;

  if ((side === "buy" && !bullishAlignment && buyScore < 82) || (side === "sell" && !bearishAlignment && sellScore < 82)) {
    warnings.push("⚠ Full alignment nahi hai, isliye WAIT better hai");
    decision = "WAIT / CONFIRMATION";
    side = "wait";
  }

  // Too many warnings downgrade a normal BUY/SELL.
  if (warnings.length >= 3 && (decision === "BUY" || decision === "SELL")) {
    warnings.push("⚠ Warnings zyada hain, signal WAIT me downgrade hua");
    decision = "WAIT / CONFIRMATION";
    side = "wait";
  }

  let confidence;
  if (side === "buy") confidence = clamp(60 + buyScore * 0.35 - sellScore * 0.15, 65, 95);
  else if (side === "sell") confidence = clamp(60 + sellScore * 0.35 - buyScore * 0.15, 65, 95);
  else confidence = clamp(42 + Math.max(buyScore, sellScore) * 0.18 - scoreGap * 0.08, 35, 64);

  confidence = Math.round(confidence);
  const grade = confidence >= 88 ? "A+" : confidence >= 82 ? "A" : confidence >= 72 ? "B+" : confidence >= 62 ? "B" : confidence >= 50 ? "C" : "AVOID";
  const risk = confidence >= 85 ? "LOW" : confidence >= 70 ? "MEDIUM" : "HIGH";

  const slGap = Math.max(range * 0.45, price * 0.004);
  const isSell = side === "sell";
  const entryLow = side === "buy" ? price - price * 0.0015 : price;
  const entryHigh = side === "buy" ? price + price * 0.001 : price;
  const stopLoss = isSell ? price + slGap : price - slGap;
  const target1 = isSell ? price - slGap * 1.5 : price + slGap * 1.5;
  const target2 = isSell ? price - slGap * 2.2 : price + slGap * 2.2;
  const target3 = isSell ? price - slGap * 3 : price + slGap * 3;

  // Show only clear reasons for the final direction.
  const finalMessage =
    side === "buy"
      ? "BUY setup hai, lekin entry, stop loss aur risk strictly follow kare."
      : side === "sell"
      ? "SELL setup hai, risk control ke saath trade kare."
      : "WAIT kare. Trade quality abhi strong nahi hai.";

  // Add summary lines at bottom for UI.
  reasons.push(`➜ Bullish strength: ${buyScore}%`);
  reasons.push(`➜ Bearish strength: ${sellScore}%`);

  return {
    symbol,
    decision,
    confidence,
    grade,
    tradeScore: confidence,
    risk,
    price: round(price),
    ema9: round(ema9),
    ema20: round(ema20),
    rsi: round(rsi),
    macd: round(macd),
    signal: round(signal),
    histogram: round(histogram),
    buyConfirmations,
    sellConfirmations,
    buyScore,
    sellScore,
    bullishStrength: buyScore,
    bearishStrength: sellScore,
    entryZone: { low: round(entryLow), high: round(entryHigh) },
    stopLoss: round(stopLoss),
    targets: { t1: round(target1), t2: round(target2), t3: round(target3) },
    rvol: round(rvol, 2),
    dayPosition: round(pos, 1),
    changePct: round(changePct, 2),
    reasons,
    warnings,
    finalMessage
  };
}

module.exports = { buildDecision };
