const axios = require("axios");

const NSE_BASE = "https://www.nseindia.com";
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map();

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
  "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-board-meetings"
};

const ALIAS = {
  HCLTECHNOLOGIES: "HCLTECH",
  HCLTECHNOLOGY: "HCLTECH",
  HCL: "HCLTECH",
  INFOSYS: "INFY",
  TATACONSULTANCYSERVICES: "TCS",
  TATACONSULTANCY: "TCS",
  RELIANCEINDUSTRIES: "RELIANCE",
  STATEBANKOFINDIA: "SBIN",
  HDFCBANKLTD: "HDFCBANK",
  ICICIBANKLTD: "ICICIBANK",
  BHARTIAIRTEL: "BHARTIARTL",
  LARSENANDTOUBRO: "LT"
};

const FALLBACK = {
  HCLTECH: {
    symbol: "HCLTECH",
    resultDate: "2026-07-13",
    eventType: "Quarterly Result / Board Meeting",
    dividend: "Board may consider interim dividend",
    source: "Fallback"
  },
  TCS: {
    symbol: "TCS",
    resultDate: "2026-07-09",
    eventType: "Quarterly Result / Board Meeting",
    source: "Fallback"
  },
  INFY: {
    symbol: "INFY",
    resultDate: "2026-07-16",
    eventType: "Quarterly Result / Board Meeting",
    source: "Fallback"
  },
  WIPRO: {
    symbol: "WIPRO",
    resultDate: "2026-07-17",
    eventType: "Quarterly Result / Board Meeting",
    source: "Fallback"
  }
};

function normalizeSymbol(symbol) {
  let s = String(symbol || "").trim().toUpperCase();
  s = s.replace(/[^A-Z0-9&]/g, "");
  return ALIAS[s] || s;
}

function ymd(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
}

function parseDate(v) {
  if (!v) return null;
  const t = String(v).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  const dmy = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : ymd(d);
}
function daysLeft(dateText) {
  if (!dateText) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const d = new Date(dateText + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;

  d.setHours(0, 0, 0, 0);
  return Math.ceil((d - today) / (1000 * 60 * 60 * 24));
}

function textOf(item) {
  return [
    item?.purpose,
    item?.Purpose,
    item?.desc,
    item?.subject,
    item?.sm_name,
    item?.attchmntText,
    item?.details,
    item?.bm_purpose,
    item?.meetingPurpose
  ].filter(Boolean).join(" ");
}

function symbolOf(item) {
  return String(
    item?.symbol ||
    item?.Symbol ||
    item?.sm_symbol ||
    item?.smSymbol ||
    item?.nseSymbol ||
    ""
  ).toUpperCase();
}

function dateOf(item) {
  const fields = [
    item?.meetingDate,
    item?.bm_date,
    item?.boardMeetingDate,
    item?.date,
    item?.dt,
    item?.an_dt,
    item?.exDate,
    item?.recordDate,
    item?.bcStartDate
  ];

  for (const f of fields) {
    const d = parseDate(f);
    if (d) return d;
  }

  return null;
}

function classify(text) {
  const t = String(text || "").toUpperCase();

  if (
    t.includes("FINANCIAL RESULT") ||
    t.includes("FINANCIAL RESULTS") ||
    t.includes("RESULT") ||
    t.includes("AUDITED") ||
    t.includes("UNAUDITED") ||
    t.includes("QUARTER")
  ) {
    return "Quarterly Result / Board Meeting";
  }

  if (t.includes("DIVIDEND")) return "Dividend";
  if (t.includes("BONUS")) return "Bonus";
  if (t.includes("SPLIT") || t.includes("SUB-DIVISION")) return "Split";
  if (t.includes("AGM")) return "AGM";

  return null;
}

function useful(item) {
  return Boolean(classify(textOf(item)));
}

async function cookies() {
  const r = await axios.get(NSE_BASE, {
    headers: HEADERS,
    timeout: 8000
  });

  return (r.headers["set-cookie"] || [])
    .map(c => c.split(";")[0])
    .join("; ");
}

async function get(url, cookie) {
  const r = await axios.get(url, {
    headers: {
      ...HEADERS,
      Cookie: cookie
    },
    timeout: 12000
  });

  if (Array.isArray(r.data)) return r.data;
  if (Array.isArray(r.data?.data)) return r.data.data;
  if (Array.isArray(r.data?.rows)) return r.data.rows;

  return [];
}
async function tryUrls(urls, symbol, cookie) {
  for (const url of urls) {
    try {
      const arr = await get(url, cookie);
      if (!arr.length) continue;

      return arr.filter(item => {
        const s = symbolOf(item);
        return (!s || s === symbol) && useful(item);
      });
    } catch (e) {
      // Try next URL
    }
  }

  return [];
}

async function fetchBoardMeetings(symbol, cookie) {
  const from = ymd(new Date());
  const to = addDays(90);

  return tryUrls([
    `${NSE_BASE}/api/corporate-board-meetings?index=equities&symbol=${encodeURIComponent(symbol)}`,
    `${NSE_BASE}/api/corporate-board-meetings?index=equities&from_date=${from}&to_date=${to}`,
    `${NSE_BASE}/api/corporate-board-meetings?index=equities`
  ], symbol, cookie);
}

async function fetchCorporateActions(symbol, cookie) {
  const from = ymd(new Date());
  const to = addDays(90);

  return tryUrls([
    `${NSE_BASE}/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol)}`,
    `${NSE_BASE}/api/corporates-corporateActions?index=equities&from_date=${from}&to_date=${to}`,
    `${NSE_BASE}/api/corporate-actions?index=equities&symbol=${encodeURIComponent(symbol)}`,
    `${NSE_BASE}/api/corporate-actions?index=equities`
  ], symbol, cookie);
}

async function fetchAnnouncements(symbol, cookie) {
  return tryUrls([
    `${NSE_BASE}/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`,
    `${NSE_BASE}/api/corporate-announcements?index=equities`
  ], symbol, cookie);
}

function blank(symbol, source = "NSE") {
  return {
    symbol,
    resultDate: null,
    eventType: null,
    dividend: null,
    bonus: null,
    split: null,
    agm: null,
    source,
    upcoming: false,
    daysLeft: null,
    message: "No upcoming result/corporate event found."
  };
}

function build(symbol, lists) {
  const event = blank(symbol, "NSE");
  const all = [];

  lists.board.forEach(x => all.push({ ...x, _src: "NSE Board Meetings" }));
  lists.actions.forEach(x => all.push({ ...x, _src: "NSE Corporate Actions" }));
  lists.ann.forEach(x => all.push({ ...x, _src: "NSE Announcements" }));

  for (const item of all) {
    const txt = textOf(item);
    const type = classify(txt);
    const d = dateOf(item);
    const left = daysLeft(d);

    if (type && type.includes("Result") && d && left !== null && left >= -2 && left <= 90) {
      if (!event.resultDate || Math.abs(left) < Math.abs(daysLeft(event.resultDate) ?? 999)) {
        event.resultDate = d;
        event.eventType = type;
        event.source = item._src;
      }
    }

    if (type === "Dividend" && !event.dividend) event.dividend = txt;
    if (type === "Bonus" && !event.bonus) event.bonus = txt;
    if (type === "Split" && !event.split) event.split = txt;
    if (type === "AGM" && !event.agm) event.agm = txt;
  }

  return event;
}
function fallback(symbol) {
  const f = FALLBACK[symbol];
  if (!f) return blank(symbol, "Fallback");

  const ev = { ...blank(symbol, "Fallback"), ...f };

  if (ev.resultDate) {
    ev.daysLeft = daysLeft(ev.resultDate);
    ev.upcoming = ev.daysLeft >= 0;
    ev.message =
      ev.daysLeft === 0
        ? "Result today."
        : ev.daysLeft > 0
        ? `Result in ${ev.daysLeft} days.`
        : "Result declared recently.";
  }

  return ev;
}

async function getCorporateEvents(inputSymbol) {
  const symbol = normalizeSymbol(inputSymbol);

  if (!symbol) {
    throw new Error("Symbol is required");
  }

  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.time < CACHE_MS) {
    return {
      ...cached.data,
      cached: true
    };
  }

  let finalEvent;

  try {
    const cookie = await cookies();

    const [board, actions, ann] = await Promise.all([
      fetchBoardMeetings(symbol, cookie),
      fetchCorporateActions(symbol, cookie),
      fetchAnnouncements(symbol, cookie)
    ]);

    finalEvent = build(symbol, {
      board,
      actions,
      ann
    });

    if (
      !finalEvent.resultDate &&
      !finalEvent.dividend &&
      !finalEvent.bonus &&
      !finalEvent.split &&
      !finalEvent.agm
    ) {
      finalEvent = fallback(symbol);
    } else {
      finalEvent.daysLeft = finalEvent.resultDate
        ? daysLeft(finalEvent.resultDate)
        : null;

      finalEvent.upcoming =
        finalEvent.daysLeft !== null && finalEvent.daysLeft >= 0;

      finalEvent.message = finalEvent.resultDate
        ? (finalEvent.daysLeft === 0
            ? "Result today."
            : `Result in ${finalEvent.daysLeft} days.`)
        : "Corporate action found.";
    }

  } catch (err) {
    finalEvent = fallback(symbol);
    finalEvent.error = err.message;
  }

  cache.set(symbol, {
    time: Date.now(),
    data: finalEvent
  });

  return finalEvent;
}

module.exports = {
  getCorporateEvents,
  normalizeSymbol
};
