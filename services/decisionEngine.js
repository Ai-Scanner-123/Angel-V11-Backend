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

function add(condition, list, text) {
  if (condition) list.push(text);
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

  const range = Math.max(high - low, price * 0.006);
  const rvol = avgVolume > 0 ? volume / avgVolume : 1;
  const pos = range > 0 ? ((price - low) / range) * 100 : 50;

  const reasons = [];
  const warnings = [];

  const buyChecks = [
    { ok: price > ema9, text: "Price EMA 9 ke upar hai" },
    { ok: ema9 > ema20, text: "EMA 9 EMA 20 ke upar hai" },
    { ok: rsi > 55, text: "RSI 55 ke upar bullish confirmation de raha hai" },
    { ok: macd > signal, text: "MACD Signal line ke upar hai" },
    { ok: histogram > 0, text: "Histogram positive hai" },
    { ok: price > prev, text: "Price previous close ke upar hai" },
    { ok: price > vwap, text: "Price VWAP ke upar hai" },
    { ok: rvol >= 1.2 || volume === 0, text: "Volume confirmation acceptable hai" },
    { ok: marketTrend === "bullish" || marketTrend === "neutral" || marketTrend === "sideways", text: "Market trend buy ke against nahi hai" }
  ];

  const sellChecks = [
    { ok: price < ema9, text: "Price EMA 9 ke neeche hai" },
    { ok: ema9 < ema20, text: "EMA 9 EMA 20 ke neeche hai" },
    { ok: rsi < 45, text: "RSI 45 ke neeche bearish confirmation de raha hai" },
    { ok: macd < signal, text: "MACD Signal line ke neeche hai" },
    { ok: histogram < 0, text: "Histogram negative hai" },
    { ok: price < prev, text: "Price previous close ke neeche hai" },
    { ok: price < vwap, text: "Price VWAP ke neeche hai" },
    { ok: rvol >= 1.2 || volume === 0, text: "Volume confirmation acceptable hai" },
    { ok: marketTrend === "bearish" || marketTrend === "neutral" || marketTrend === "sideways", text: "Market trend sell ke against nahi hai" }
  ];

  const buyConfirmations = buyChecks.filter(x => x.ok).length;
  const sellConfirmations = sellChecks.filter(x => x.ok).length;

  let decision = "WAIT";
  let side = "wait";

  if (buyConfirmations >= 7 && sellConfirmations <= 3) {
    decision = "STRONG BUY";
    side = "buy";
  } else if (buyConfirmations >= 6 && sellConfirmations <= 4) {
    decision = "BUY";
    side = "buy";
  } else if (sellConfirmations >= 7 && buyConfirmations <= 3) {
    decision = "STRONG SELL";
    side = "sell";
  } else if (sellConfirmations >= 6 && buyConfirmations <= 4) {
    decision = "SELL";
    side = "sell";
  }

  if (decision.includes("BUY")) {
    buyChecks.filter(x => x.ok).forEach(x => reasons.push("✔ " + x.text));
    sellChecks.filter(x => x.ok).slice(0, 4).forEach(x => warnings.push("⚠ Against buy: " + x.text));
  } else if (decision.includes("SELL")) {
    sellChecks.filter(x => x.ok).forEach(x => reasons.push("✔ " + x.text));
    buyChecks.filter(x => x.ok).slice(0, 4).forEach(x => warnings.push("⚠ Against sell: " + x.text));
  } else {
    if (buyConfirmations > sellConfirmations) reasons.push(`➜ Buy confirmations ${buyConfirmations}/9 hain, lekin strong trade ke liye enough nahi`);
    else if (sellConfirmations > buyConfirmations) reasons.push(`➜ Sell confirmations ${sellConfirmations}/9 hain, lekin strong trade ke liye enough nahi`);
    else reasons.push("➜ Buy/Sell confirmations equal hain");
    warnings.push("⚠ WAIT: EMA, RSI, MACD, VWAP/Prev Close me full alignment nahi hai");
  }

  if (pos >= 80) warnings.push("⚠ Price day high ke paas hai - chase avoid kare");
  if (pos <= 20) warnings.push("⚠ Price day low ke paas hai - fresh entry me confirmation zaroori");
  if (rsi > 70) warnings.push("⚠ RSI overbought hai");
  if (rsi < 30) warnings.push("⚠ RSI oversold hai");

  let confidence;
  if (decision === "STRONG BUY") confidence = 88 + Math.min(7, buyConfirmations - 7);
  else if (decision === "BUY") confidence = 72 + Math.min(8, buyConfirmations - 6);
  else if (decision === "STRONG SELL") confidence = 88 + Math.min(7, sellConfirmations - 7);
  else if (decision === "SELL") confidence = 72 + Math.min(8, sellConfirmations - 6);
  else confidence = 45 + Math.min(15, Math.max(buyConfirmations, sellConfirmations) * 2);

  if (warnings.length >= 3 && decision !== "WAIT") {
    confidence -= 8;
    if (decision === "BUY" || decision === "SELL") {
      decision = "WAIT";
      side = "wait";
      warnings.push("⚠ Warnings zyada hain, isliye signal WAIT me downgrade hua");
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
        ? "BUY setup hai, lekin entry, stop loss aur risk strictly follow kare."
        : decision.includes("SELL")
        ? "SELL setup hai, risk control ke saath trade kare."
        : "WAIT kare. Trade quality abhi strong nahi hai."
  };
}

module.exports = { buildDecision };
