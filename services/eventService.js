const axios = require("axios");

// ======================================================
// AI NSE Scanner - Corporate Event / Result Alert Service
// File: services/eventService.js
// ======================================================
//
// यह service /api/market/events route के लिए है.
// काम:
// - NSE corporate announcements से Result / Dividend / Bonus / Split check
// - 1 घंटे का cache
// - अगर NSE response fail हो तो fallback data
//
// Note:
// NSE public endpoints कभी-कभी block/slow हो सकते हैं.
// इसलिए timeout + fallback रखा गया है.
// ======================================================

const CACHE_MS = 60 * 60 * 1000; // 1 hour
const eventCache = new Map();

const NSE_BASE = "https://www.nseindia.com";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
  "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
  "Connection": "keep-alive"
};

// Backup data: अगर NSE endpoint fail हो जाए तो selected important stocks के लिए alert.
// Dates आप बाद में update कर सकते हैं.
const FALLBACK_EVENTS = {
  HCLTECH: {
    symbol: "HCLTECH",
    resultDate: "2026-07-13",
    eventType: "Quarterly Result",
    dividend: "Board may consider interim dividend",
    source: "Fallback"
  },
  TCS: {
    symbol: "TCS",
    resultDate: "2026-07-09",
    eventType: "Quarterly Result",
    source: "Fallback"
  },
  INFY: {
    symbol: "INFY",
    resultDate: "2026-07-16",
    eventType: "Quarterly Result",
    source: "Fallback"
  },
  WIPRO: {
    symbol: "WIPRO",
    resultDate: "2026-07-17",
    eventType: "Quarterly Result",
    source: "Fallback"
  },
  RELIANCE: {
    symbol: "RELIANCE",
    resultDate: null,
    eventType: null,
    source: "Fallback"
  },
  SBIN: {
    symbol: "SBIN",
    resultDate: null,
    eventType: null,
    source: "Fallback"
  }
};

const SYMBOL_ALIASES = {
  HCLTECHNOLOGIES: "HCLTECH",
  HCLTECHNOLOGY: "HCLTECH",
  HCL: "HCLTECH",
  TATACONSULTANCY: "TCS",
  TATACONSULTANCYSERVICES: "TCS",
  INFOSYS: "INFY",
  RELIANCEINDUSTRIES: "RELIANCE",
  STATEBANKOFINDIA: "SBIN",
  HDFCBANKLTD: "HDFCBANK",
  ICICIBANKLTD: "ICICIBANK",
  AXISBANKLTD: "AXISBANK",
  BHARTIAIRTEL: "BHARTIARTL"
};

function normalizeSymbol(symbol) {
  let s = String(symbol || "").trim().toUpperCase();
  s = s.replace(/[^A-Z0-9]/g, "");
  return SYMBOL_ALIASES[s] || s;
}

function formatDateYYYYMMDD(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseAnyDate(value) {
  if (!value) return null;

  const text = String(value).trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    const yyyy = dmy[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateYYYYMMDD(parsed);
  }

  return null;
}

function daysBetweenToday(dateText) {
  if (!dateText) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const d = new Date(dateText + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);

  return Math.ceil((d - today) / (1000 * 60 * 60 * 24));
}

function classifyAnnouncement(item) {
  const combined = [
    item?.desc,
    item?.subject,
    item?.sm_name,
    item?.attchmntText,
    item?.details,
    item?.purpose
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  if (
    combined.includes("FINANCIAL RESULT") ||
    combined.includes("FINANCIAL RESULTS") ||
    combined.includes("RESULT") ||
    combined.includes("BOARD MEETING")
  ) {
    return "Quarterly Result";
  }

  if (combined.includes("DIVIDEND")) {
    return "Dividend";
  }

  if (combined.includes("BONUS")) {
    return "Bonus";
  }

  if (combined.includes("SPLIT") || combined.includes("SUB-DIVISION")) {
    return "Split";
  }

  if (combined.includes("AGM")) {
    return "AGM";
  }

  return null;
}

function extractEventDate(item) {
  // NSE responses अलग-अलग fields में date दे सकते हैं.
  const possible = [
    item?.an_dt,
    item?.exDate,
    item?.recordDate,
    item?.bcStartDate,
    item?.meetingDate,
    item?.date,
    item?.dt
  ];

  for (const p of possible) {
    const parsed = parseAnyDate(p);
    if (parsed) return parsed;
  }

  return null;
}

async function getNseCookies() {
  const home = await axios.get(NSE_BASE, {
    headers: DEFAULT_HEADERS,
    timeout: 8000
  });

  const cookies = home.headers["set-cookie"] || [];
  return cookies.map(c => c.split(";")[0]).join("; ");
}

async function fetchNseAnnouncements(symbol) {
  const cookie = await getNseCookies();

  const url =
    `${NSE_BASE}/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`;

  const response = await axios.get(url, {
    headers: {
      ...DEFAULT_HEADERS,
      Cookie: cookie
    },
    timeout: 10000
  });

  if (!Array.isArray(response.data)) {
    return [];
  }

  return response.data;
}

function buildBestEvent(symbol, announcements) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let best = {
    symbol,
    resultDate: null,
    eventType: null,
    dividend: null,
    bonus: null,
    split: null,
    source: "NSE",
    rawCount: announcements.length
  };

  for (const item of announcements) {
    const eventType = classifyAnnouncement(item);
    if (!eventType) continue;

    const eventDate = extractEventDate(item);
    const title = item?.desc || item?.subject || item?.attchmntText || "";

    if (eventType === "Dividend") {
      best.dividend = title || "Dividend related announcement";
    }

    if (eventType === "Bonus") {
      best.bonus = title || "Bonus related announcement";
    }

    if (eventType === "Split") {
      best.split = title || "Split related announcement";
    }

    // Result/Board meeting को priority दें
    if (eventType === "Quarterly Result") {
      let dateToUse = eventDate;

      // अगर date न मिले तो announcement date use करेंगे,
      // लेकिन केवल information के लिए.
      if (!dateToUse) {
        dateToUse = parseAnyDate(item?.an_dt);
      }

      if (dateToUse) {
        const diff = daysBetweenToday(dateToUse);

        // upcoming 0-30 days या recently declared -5 days तक useful
        if (diff !== null && diff >= -5 && diff <= 30) {
          if (!best.resultDate) {
            best.resultDate = dateToUse;
            best.eventType = "Quarterly Result";
          } else {
            const oldDiff = Math.abs(daysBetweenToday(best.resultDate) ?? 999);
            const newDiff = Math.abs(diff);
            if (newDiff < oldDiff) {
              best.resultDate = dateToUse;
              best.eventType = "Quarterly Result";
            }
          }
        }
      }
    }
  }

  return best;
}

function fallbackEvent(symbol) {
  const ev = FALLBACK_EVENTS[symbol];

  if (!ev) {
    return {
      symbol,
      resultDate: null,
      eventType: null,
      dividend: null,
      bonus: null,
      split: null,
      source: "Fallback",
      message: "No upcoming corporate event found in fallback."
    };
  }

  return {
    symbol,
    resultDate: ev.resultDate || null,
    eventType: ev.eventType || null,
    dividend: ev.dividend || null,
    bonus: ev.bonus || null,
    split: ev.split || null,
    source: ev.source || "Fallback"
  };
}

async function getCorporateEvents(inputSymbol) {
  const symbol = normalizeSymbol(inputSymbol);

  if (!symbol) {
    throw new Error("Symbol is required");
  }

  const cached = eventCache.get(symbol);
  if (cached && Date.now() - cached.time < CACHE_MS) {
    return {
      ...cached.data,
      cached: true
    };
  }

  let finalEvent;

  try {
    const announcements = await fetchNseAnnouncements(symbol);
    const nseEvent = buildBestEvent(symbol, announcements);

    // अगर NSE से कुछ useful मिला तो वही use करें
    if (
      nseEvent.resultDate ||
      nseEvent.dividend ||
      nseEvent.bonus ||
      nseEvent.split
    ) {
      finalEvent = nseEvent;
    } else {
      finalEvent = fallbackEvent(symbol);
      finalEvent.nseChecked = true;
      finalEvent.rawCount = announcements.length;
    }
  } catch (err) {
    finalEvent = fallbackEvent(symbol);
    finalEvent.error = err.message;
  }

  eventCache.set(symbol, {
    time: Date.now(),
    data: finalEvent
  });

  return finalEvent;
}

module.exports = {
  getCorporateEvents,
  normalizeSymbol
};
