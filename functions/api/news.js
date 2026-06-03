import { defaultPortfolio, fetchPortfolio, json } from "../_shared.js";

function kstDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function todayKstKey(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripPublisher(title = "") {
  return decodeXml(title).replace(/\s+-\s+[^-]+$/, "").trim();
}

function textOf(block, tag) {
  return block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "";
}

function parseRssItems(xml = "") {
  const items = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const title = textOf(block, "title");
    const link = textOf(block, "link");
    const source = textOf(block, "source");
    const pubDate = textOf(block, "pubDate");
    if (!title || !link) continue;
    if (!pubDate || todayKstKey(pubDate) !== kstDate()) continue;
    items.push({
      title: stripPublisher(title),
      title_ko: stripPublisher(title),
      link: decodeXml(link).trim(),
      source: decodeXml(source).trim(),
      published_at: new Date(pubDate).toISOString(),
    });
  }
  return items;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function googleNews(query, { hl = "ko", gl = "KR", ceid = "KR:ko", limit = 3 } = {}) {
  const today = kstDate();
  const tomorrow = kstDate(1);
  const rssQuery = `${query} when:1d after:${today} before:${tomorrow}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(rssQuery)}&hl=${hl}&gl=${gl}&ceid=${ceid}&scoring=n`;
  const response = await fetchWithTimeout(url, { headers: { "user-agent": "Briefolio/1.0" } });
  if (!response.ok) return [];
  return parseRssItems(await response.text()).slice(0, limit);
}

function normalizeTerm(value = "") {
  return String(value).toLowerCase().trim();
}

function holdingTerms(item) {
  const symbol = normalizeTerm(item.symbol);
  const name = normalizeTerm(item.name);
  const terms = [symbol, name].filter(Boolean);
  if (symbol === "qqqm") terms.push("invesco", "nasdaq 100", "nasdaq-100", "qqq");
  if (symbol === "voo") terms.push("vanguard", "s&p 500", "sp 500", "s&p");
  if (symbol === "nvda" || name.includes("nvidia")) terms.push("nvidia");
  if (symbol === "aapl" || name.includes("apple")) terms.push("apple");
  return [...new Set(terms.filter((term) => term.length >= 2))];
}

function holdingsQueries(portfolio) {
  const holdings = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
  const domesticHoldings = holdings.filter((item) => item.market === "KR");
  const overseasHoldings = holdings.filter((item) => item.market !== "KR");
  const domestic = domesticHoldings.length ? domesticHoldings : [{ name: "삼성전자", symbol: "005930", market: "KR" }];
  const overseas = overseasHoldings.length ? overseasHoldings : [
    { name: "QQQM", symbol: "QQQM", market: "US" },
    { name: "VOO", symbol: "VOO", market: "US" },
  ];
  return {
    domesticQueries: domestic.flatMap((item) => [
      `${item.name || item.symbol} 주가`,
      `${item.name || item.symbol} 실적`,
    ]),
    overseasQueries: overseas.flatMap((item) => [
      `${item.symbol} stock`,
      `${item.name || item.symbol} stock`,
    ]),
    domesticTerms: [...new Set(domestic.flatMap(holdingTerms))],
    overseasTerms: [...new Set(overseas.flatMap(holdingTerms))],
  };
}

const BAD_OVERSEAS_TERMS = [
  "football", "soccer", "villa", "liverpool", "match", "tickets", "season tickets",
  "nba", "nfl", "mlb", "gaming tournament", "lottery",
];

function isRelevant(item, terms, market) {
  const haystack = normalizeTerm(`${item.title} ${item.title_ko} ${item.source}`);
  if (!haystack) return false;
  if (market === "overseas" && BAD_OVERSEAS_TERMS.some((term) => haystack.includes(term))) return false;
  if (!terms.length) return true;
  return terms.some((term) => haystack.includes(term));
}

async function collectNews(queries, options, terms, market) {
  const seen = new Set();
  const items = [];
  const limitedQueries = [...new Set(queries)].slice(0, 8);
  const results = await Promise.allSettled(limitedQueries.map((query) => googleNews(query, { ...options, limit: 6 })));
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const found = result.value || [];
    for (const item of found) {
      const key = `${item.title}|${item.source}`.toLowerCase();
      if (seen.has(key) || !isRelevant(item, terms, market)) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= 3) return items;
    }
  }
  return items;
}

export async function onRequestGet({ env }) {
  try {
    const portfolio = await fetchPortfolio(env).catch(() => defaultPortfolio());
    const queries = holdingsQueries(portfolio);
    const [domestic, overseas] = await Promise.all([
      collectNews(queries.domesticQueries, { hl: "ko", gl: "KR", ceid: "KR:ko" }, queries.domesticTerms, "domestic"),
      collectNews(queries.overseasQueries, { hl: "en", gl: "US", ceid: "US:en" }, queries.overseasTerms, "overseas"),
    ]);
    return json({
      domestic,
      overseas,
      updatedAt: new Date().toISOString(),
      basis: "KST today only, Google News RSS pubDate checked",
    });
  } catch (error) {
    return json({ domestic: [], overseas: [], error: error.message });
  }
}
