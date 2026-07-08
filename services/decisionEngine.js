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
  const avgVolume = num(input.avgVolume || input.averageVolume, volume || 1);
  const vwap = num(input.vwap, price);
  const rsi = num(input.rsi, 50);
  const ema9 = num(input.ema9, price);
  const ema20 = num(input.ema20, price);
  const macd = num(input.macd, 0);
  const signal = num(input.macdSignal || input.signal, 0);
  const histogram = num(input.histogram, macd - signal);
  const marketTrend = String(input.marketTrend || input.trend || "neutral").toLowerCase();
  const volumeStrength = String(input.volumeStrength || input.vol || "normal").toLowerCase();

  const range = Math.max(high - low, price * 0.006);
  const rvol = avgVolume > 0 ? volume / avgVolume : 1;
  const pos = range > 0 ? ((price - low) / range) * 100 : 50;
  const highRvol = volumeStrength === "high" || rvol >= 1.2;
  const lowRvol = volumeStrength === "low" || (volume > 0 && rvol < 0.8);

  const buyChecks = [
    { ok: price > ema9, text: "Price EMA 9 के ऊपर है", type: "direction" },
    { ok: ema9 > ema20, text: "EMA 9 EMA 20 के ऊपर है", type: "direction" },
    { ok: rsi > 50, text: "RSI buy side में है", type: "direction" },
    { ok: macd > signal, text: "MACD Signal line के ऊपर है", type: "direction" },
    { ok: histogram > 0, text: "Histogram positive है", type: "direction" },
    { ok: price > prev, text: "Price previous close के ऊपर है", type: "direction" },
    { ok: highRvol, text: "High RVOL है", type: "quality" },
    { ok: marketTrend === "bullish", text: "Market bullish है", type: "market" }
  ];

  const sellChecks = [
    { ok: price < ema9, text: "Price EMA 9 के नीचे है", type: "direction" },
    { ok: ema9 < ema20, text: "EMA 9 EMA 20 के नीचे है", type: "direction" },
    { ok: rsi < 45, text: "RSI sell side में है", type: "direction" },
    { ok: macd < signal, text: "MACD Signal line के नीचे है", type: "direction" },
    { ok: histogram < 0, text: "Histogram negative है", type: "direction" },
    { ok: price < prev, text: "Price previous close के नीचे है", type: "direction" },
    { ok: highRvol, text: "High RVOL है", type: "quality" },
    { ok: marketTrend === "bearish", text: "Market bearish है", type: "market" }
  ];

  const buyConfirmations = buyChecks.filter(x => x.ok).length;
  const sellConfirmations = sellChecks.filter(x => x.ok).length;
  const buyDirectional = buyChecks.filter(x => x.ok && x.type === "direction").length;
  const sellDirectional = sellChecks.filter(x => x.ok && x.type === "direction").length;

  let decision = "WAIT";
  let side = "wait";

  if (buyConfirmations >= 7 && sellDirectional <= 1) {
    decision = "STRONG BUY";
    side = "buy";
  } else if (buyConfirmations >= 6 && sellDirectional <= 2) {
    decision = "BUY";
    side = "buy";
  } else if (sellConfirmations >= 7 && buyDirectional <= 1) {
    decision = "STRONG SELL";
    side = "sell";
  } else if (sellConfirmations >= 6 && buyDirectional <= 2) {
    decision = "SELL";
    side = "sell";
  }

  const reasons = [];
  const warnings = [];

  if (side === "buy") {
    buyChecks.filter(x => x.ok).forEach(x => reasons.push("✔ " + x.text));
    sellChecks
      .filter(x => x.ok && x.type === "direction")
      .slice(0, 3)
      .forEach(x => warnings.push("⚠ Buy के against: " + x.text));
  } else if (side === "sell") {
    sellChecks.filter(x => x.ok).forEach(x => reasons.push("✔ " + x.text));
    buyChecks
      .filter(x => x.ok && x.type === "direction")
      .slice(0, 3)
      .forEach(x => warnings.push("⚠ Sell के against: " + x.text));
  } else {
    if (buyConfirmations > sellConfirmations) {
      reasons.push(`➜ Buy confirmations ${buyConfirmations}/8 हैं, लेकिन full alignment नहीं है`);
    } else if (sellConfirmations > buyConfirmations) {
      reasons.push(`➜ Sell confirmations ${sellConfirmations}/8 हैं, लेकिन full alignment नहीं है`);
    } else {
      reasons.push("➜ Buy/Sell confirmations बराबर हैं");
    }
    warnings.push("⚠ Full alignment नहीं है, इसलिए WAIT बेहतर है");
  }

  if (pos >= 80) warnings.push("⚠ Price day high के पास है - chase avoid करें");
  if (pos <= 20) warnings.push("⚠ Price day low के पास है - fresh entry में confirmation जरूरी");
  if (rsi > 70) warnings.push("⚠ RSI overbought है");
  if (rsi < 30) warnings.push("⚠ RSI oversold है");
  if (lowRvol) warnings.push("⚠ Low RVOL: trade avoid बेहतर");
  if (marketTrend === "sideways") warnings.push("⚠ Sideways market: wait बेहतर");

  let confidence;
  if (decision === "STRONG BUY") confidence = 88 + Math.min(7, buyConfirmations - 7);
  else if (decision === "BUY") confidence = 72 + Math.min(8, buyConfirmations - 6);
  else if (decision === "STRONG SELL") confidence = 88 + Math.min(7, sellConfirmations - 7);
  else if (decision === "SELL") confidence = 72 + Math.min(8, sellConfirmations - 6);
  else confidence = 45 + Math.min(15, Math.max(buyConfirmations, sellConfirmations) * 2);

  if (warnings.length >= 4 && decision !== "WAIT") {
    confidence -= 8;
    if (decision === "BUY" || decision === "SELL") {
      decision = "WAIT";
      side = "wait";
      warnings.push("⚠ Warnings ज्यादा हैं, इसलिए signal WAIT में downgrade हुआ");
    }
  }

  confidence = clamp(Math.round(confidence), 0, 95);
  const risk = confidence >= 85 ? "LOW" : confidence >= 70 ? "MEDIUM" : "HIGH";

  const slGap = Math.max(range * 0.45, price * 0.004);
  const isSell = side === "sell";
  const entryLow = side === "buy" ? price - price * 0.0015 : price;
  const entryHigh = side === "buy" ? price + price * 0.001 : price;
  const stopLoss = isSell ? price + slGap : price - slGap;
  const target1 = isSell ? price - slGap * 1.5 : price + slGap * 1.5;
  const target2 = isSell ? price - slGap * 2.2 : price + slGap * 2.2;
  const target3 = isSell ? price - slGap * 3 : price + slGap * 3;

  return {
    symbol,
    decision,
    confidence,
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
    entryZone: { low: round(entryLow), high: round(entryHigh) },
    stopLoss: round(stopLoss),
    targets: { t1: round(target1), t2: round(target2), t3: round(target3) },
    rvol: round(rvol, 2),
    reasons,
    warnings,
    finalMessage:
      decision.includes("BUY")
        ? "BUY setup है, लेकिन entry, stop loss और risk strictly follow करें."
        : decision.includes("SELL")
        ? "SELL setup है, risk control के साथ trade करें."
        : "WAIT करें. Trade quality अभी strong नहीं है."
  };
}

module.exports = { buildDecision };
