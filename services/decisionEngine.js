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

function moneySafe(v) {
  return round(v, 2);
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
  const atr = num(input.atr, 0);
  const marketTrend = String(input.marketTrend || input.trend || "neutral").toLowerCase();

  const range = Math.max(high - low, price * 0.006);
  const pos = range > 0 ? ((price - low) / range) * 100 : 50;
  const changePct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
  const rvol = avgVolume > 0 ? volume / avgVolume : (volume > 0 ? 1.3 : 1);

  const buyReasons = [];
  const sellReasons = [];
  const warnings = [];

  let buyScore = 0;
  let sellScore = 0;

  function buy(ok, weight, text) {
    if (ok) {
      buyScore += weight;
      buyReasons.push("✔ " + text);
    }
  }

  function sell(ok, weight, text) {
    if (ok) {
      sellScore += weight;
      sellReasons.push("✔ " + text);
    }
  }

  // ===== Core trend confirmations =====
  buy(price > ema9, 14, "Price EMA 9 ke upar hai");
  sell(price < ema9, 14, "Price EMA 9 ke neeche hai");

  buy(ema9 > ema20, 16, "EMA 9 EMA 20 ke upar hai");
  sell(ema9 < ema20, 16, "EMA 9 EMA 20 ke neeche hai");

  // RSI: avoid giving both sides credit in neutral zone.
  buy(rsi >= 55 && rsi <= 72, 14, "RSI bullish zone me hai");
  sell(rsi <= 45 && rsi >= 28, 14, "RSI bearish zone me hai");

  // MACD and histogram.
  buy(macd > signal, 14, "MACD Signal line ke upar hai");
  sell(macd < signal, 14, "MACD Signal line ke neeche hai");

  buy(histogram > 0, 10, "Histogram positive hai");
  sell(histogram < 0, 10, "Histogram negative hai");

  // Price strength.
  buy(price > prev, 12, "Price previous close ke upar hai");
  sell(price < prev, 12, "Price previous close ke neeche hai");

  buy(price > open, 6, "Stock intraday open se upar hai");
  sell(price < open, 6, "Stock intraday open se neeche hai");

  buy(price > vwap, 8, "Price VWAP ke upar hai");
  sell(price < vwap, 8, "Price VWAP ke neeche hai");

  // Market trend supports only its direction. Neutral does not add to both sides.
  buy(marketTrend === "bullish", 8, "Market bullish hai");
  sell(marketTrend === "bearish", 8, "Market bearish hai");

  // Volume confirms whichever side is already stronger. It is never an against-warning.
  const highRvol = rvol >= 1.2 || volume === 0;
  if (highRvol) {
    if (buyScore > sellScore) {
      buyScore += 8;
      buyReasons.push("✔ High RVOL hai");
    } else if (sellScore > buyScore) {
      sellScore += 8;
      sellReasons.push("✔ High RVOL hai");
    } else {
      buyScore += 4;
      sellScore += 4;
      buyReasons.push("✔ High RVOL hai, lekin direction mixed hai");
      sellReasons.push("✔ High RVOL hai, lekin direction mixed hai");
    }
  } else {
    warnings.push("⚠ Volume/RVOL weak hai, trade quality reduce hoti hai");
  }

  // ===== Risk / caution filters =====
  if (pos >= 80) warnings.push("⚠ Price day high ke paas hai - fresh BUY me chase avoid kare");
  if (pos <= 20) warnings.push("⚠ Price day low ke paas hai - fresh SELL me confirmation zaroori");
  if (Math.abs(changePct) >= 3) warnings.push("⚠ Stock me big move already ho chuka hai - chase na kare");
  if (rsi > 72) warnings.push("⚠ RSI overbought hai - fresh BUY me risk high");
  if (rsi < 28) warnings.push("⚠ RSI oversold hai - fresh SELL me risk high");
  if (Math.abs(histogram) < Math.max(price * 0.00005, 0.05)) warnings.push("⚠ MACD histogram chhota hai - momentum weak/flat ho sakta hai");

  // ===== ATR + VWAP risk filters (only risk management, core indicators unchanged) =====
  const minAtr = price * 0.0005;
  const lowAtr = atr > 0 && atr < minAtr;
  const vwapGap = Math.abs(price - vwap);
  const vwapNear = atr > 0 ? vwapGap <= atr * 0.25 : vwapGap <= price * 0.001;

  if (lowAtr) warnings.push("⚠ ATR bahut low hai - movement kam hai, NO TRADE better");
  if (vwapNear) warnings.push("⚠ Price VWAP ke bahut paas hai - false move/breakout risk");

  // ===== Result / event risk support if frontend/backend provides it later =====
  const resultDaysLeftRaw = input.resultDaysLeft ?? input.daysToResult ?? input.resultInDays;
  const resultDaysLeft = Number(resultDaysLeftRaw);
  const hasResultRisk = Number.isFinite(resultDaysLeft) && resultDaysLeft >= 0 && resultDaysLeft <= 4;
  if (hasResultRisk) {
    if (resultDaysLeft === 0) warnings.push("⚠ Aaj result day hai - intraday me NO TRADE better");
    else warnings.push(`⚠ Result ${resultDaysLeft} din baad hai - extra confirmation zaroori`);
  }

  const totalPossible = 110;
  const buyStrength = Math.round(clamp((buyScore / totalPossible) * 100, 0, 100));
  const sellStrength = Math.round(clamp((sellScore / totalPossible) * 100, 0, 100));

  let decision = "WAIT / CONFIRMATION";
  let side = "wait";

  const buyLead = buyScore - sellScore;
  const sellLead = sellScore - buyScore;

  if (!hasResultRisk && buyStrength >= 78 && buyLead >= 35) {
    decision = "STRONG BUY";
    side = "buy";
  } else if (!hasResultRisk && buyStrength >= 62 && buyLead >= 22) {
    decision = "BUY";
    side = "buy";
  } else if (!hasResultRisk && sellStrength >= 78 && sellLead >= 35) {
    decision = "STRONG SELL";
    side = "sell";
  } else if (!hasResultRisk && sellStrength >= 62 && sellLead >= 22) {
    decision = "SELL";
    side = "sell";
  }

  // Extra safety: too many warnings downgrade weak BUY/SELL only.
  if ((decision === "BUY" || decision === "SELL") && warnings.length >= 3) {
    decision = "WAIT / CONFIRMATION";
    side = "wait";
    warnings.push("⚠ Warnings zyada hain, isliye signal WAIT me downgrade hua");
  }

  // Result day strict rule.
  if (Number.isFinite(resultDaysLeft) && resultDaysLeft === 0) {
    decision = "WAIT / CONFIRMATION";
    side = "wait";
  }

  // ATR/VWAP safety rule: avoid trade when volatility is too low or price is stuck around VWAP.
  if (lowAtr || vwapNear) {
    decision = "WAIT / CONFIRMATION";
    side = "wait";
  }

  let confidence;
  if (side === "buy") confidence = buyStrength;
  else if (side === "sell") confidence = sellStrength;
  else confidence = Math.round(45 + Math.min(18, Math.abs(buyStrength - sellStrength) / 2));

  if (warnings.length >= 2 && side !== "wait") confidence -= 5;
  if (warnings.length >= 4 && side !== "wait") confidence -= 8;
  confidence = clamp(Math.round(confidence), 0, 95);

  const grade = confidence >= 88 ? "A+" :
                confidence >= 80 ? "A" :
                confidence >= 70 ? "B+" :
                confidence >= 60 ? "B" :
                confidence >= 50 ? "C" : "AVOID";

  const risk = confidence >= 85 ? "LOW" : confidence >= 70 ? "MEDIUM" : "HIGH";

  // If waiting, still show nearest practical level using dominant side, but no trade should be allowed.
  const tradeSide = side === "sell" ? "sell" : "buy";
  const isSell = tradeSide === "sell";
  const atrGap = atr > 0 ? atr : Math.max(range * 0.45, price * 0.004);
  const slGap = atr > 0 ? Math.max(atrGap * 1.5, price * 0.004) : atrGap;

  const entryLow = tradeSide === "buy" ? price - price * 0.0015 : price;
  const entryHigh = tradeSide === "buy" ? price + price * 0.001 : price;
  const stopLoss = isSell ? price + slGap : price - slGap;
  const target1 = isSell ? price - atrGap * 2 : price + atrGap * 2;
  const target2 = isSell ? price - atrGap * 3 : price + atrGap * 3;
  const target3 = isSell ? price - atrGap * 4 : price + atrGap * 4;

  const reasons = side === "sell" ? sellReasons : side === "buy" ? buyReasons : [];
  if (side === "wait") {
    if (buyStrength > sellStrength) reasons.push(`➜ Bullish strength ${buyStrength}% hai, lekin full alignment nahi hai`);
    else if (sellStrength > buyStrength) reasons.push(`➜ Bearish strength ${sellStrength}% hai, lekin full alignment nahi hai`);
    else reasons.push("➜ Bullish aur Bearish strength mixed hai");
  }

  // Only opposite-side reasons become against warnings. High RVOL is excluded permanently.
  const oppositeReasons = side === "buy" ? sellReasons : side === "sell" ? buyReasons : [];
  oppositeReasons
    .filter(t => !String(t).toLowerCase().includes("rvol"))
    .slice(0, 4)
    .forEach(t => warnings.push("⚠ Against signal: " + t.replace(/^✔\s*/, "")));

  const buyConfirmations = Math.round(buyStrength / 12.5); // display only
  const sellConfirmations = Math.round(sellStrength / 12.5); // display only

  return {
    symbol,
    decision,
    confidence,
    tradeScore: confidence,
    grade,
    risk,
    side,
    price: round(price),
    previousClose: round(prev),
    open: round(open),
    high: round(high),
    low: round(low),
    changePct: round(changePct, 2),
    dayPosition: round(pos, 1),
    ema9: round(ema9),
    ema20: round(ema20),
    rsi: round(rsi),
    macd: round(macd),
    signal: round(signal),
    histogram: round(histogram),
    atr: round(atr),
    vwap: round(vwap),
    buyConfirmations: clamp(buyConfirmations, 0, 8),
    sellConfirmations: clamp(sellConfirmations, 0, 8),
    buyStrength,
    sellStrength,
    entryZone: { low: moneySafe(entryLow), high: moneySafe(entryHigh) },
    stopLoss: moneySafe(stopLoss),
    targets: { t1: moneySafe(target1), t2: moneySafe(target2), t3: moneySafe(target3) },
    rvol: round(rvol, 2),
    reasons,
    warnings: [...new Set(warnings)],
    finalMessage:
      decision.includes("BUY")
        ? "BUY setup hai, lekin entry, stop loss aur risk strictly follow kare."
        : decision.includes("SELL")
        ? "SELL setup hai, risk control ke saath trade kare."
        : "WAIT kare. Trade quality abhi strong nahi hai."
  };
}

module.exports = { buildDecision };
