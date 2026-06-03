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

function parseYahooItems(xml = "", symbol = "") {
  return parseRssItems(xml).map((item) => ({
    ...item,
    title_ko: item.title,
    symbol,
  }));
}

function parseNaverItems(html = "") {
  const items = [];
  const today = kstDate().replaceAll("-", ".");
  for (const match of html.matchAll(/<a[^>]+class="[^"]*news_tit[^"]*"[^>]+href="([^"]+)"[^>]*title="([^"]+)"[^>]*>/g)) {
    const link = decodeXml(match[1]).trim();
    const title = decodeXml(match[2]).trim();
    if (!title || !link) continue;
    const start = Math.max(0, match.index - 900);
    const end = Math.min(html.length, match.index + 900);
    const context = decodeXml(html.slice(start, end));
    const looksToday = context.includes("분 전") || context.includes("시간 전") || context.includes(today);
    if (!looksToday) continue;
    items.push({ title, title_ko: title, link, source: "Naver News", published_at: new Date().toISOString() });
  }
  return items;
}

function cleanHtmlTitle(value = "") {
  return decodeXml(String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function parseBingItems(html = "") {
  const items = [];
  for (const match of html.matchAll(/<a[^>]+class="title"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const link = decodeXml(match[1]).trim();
    const title = cleanHtmlTitle(match[2]);
    if (!title || !link) continue;
    items.push({ title, title_ko: title, link, source: "Bing News", published_at: new Date().toISOString() });
  }
  return items;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
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

async function naverNews(query, limit = 3) {
  const url = `https://search.naver.com/search.naver?where=news&sort=1&nso=so:dd,p:1d,a:all&query=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url, { headers: { "user-agent": "Mozilla/5.0 Briefolio/1.0" } });
  if (!response.ok) return [];
  return parseNaverItems(await response.text()).slice(0, limit);
}

async function bingNews(query, limit = 3) {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&qft=interval%3d%228%22&form=YFNR`;
  const response = await fetchWithTimeout(url, { headers: { "user-agent": "Mozilla/5.0 Briefolio/1.0" } });
  if (!response.ok) return [];
  return parseBingItems(await response.text()).slice(0, limit);
}

async function yahooFinanceNews(symbol, limit = 3) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const response = await fetchWithTimeout(url, { headers: { "user-agent": "Briefolio/1.0" } });
  if (!response.ok) return [];
  return parseYahooItems(await response.text(), symbol).slice(0, limit);
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
    domesticQueries: [
      ...domestic.flatMap((item) => [
        `${item.name || item.symbol} 주가`,
        `${item.name || item.symbol} 실적`,
      ]),
      "삼성전자 반도체",
      "삼성전자 HBM",
      "코스피 삼성전자",
    ],
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
  const titleText = normalizeTerm(`${item.title} ${item.title_ko}`);
  const fullText = normalizeTerm(`${item.title} ${item.title_ko} ${item.source}`);
  if (!titleText) return false;
  if (market === "domestic" && ["블로그", "카페", "지식in"].some((term) => fullText.includes(term.toLowerCase()))) return false;
  if (market === "overseas" && BAD_OVERSEAS_TERMS.some((term) => fullText.includes(term))) return false;
  if (!terms.length) return true;
  return terms.some((term) => titleText.includes(term));
}

async function collectNews(queries, options, terms, market) {
  const seen = new Set();
  const items = [];
  const limitedQueries = [...new Set(queries)].slice(0, 5);
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

async function collectDomesticFallback(queries, terms) {
  const seen = new Set();
  const items = [];
  const limitedQueries = [...new Set(queries)].slice(0, 5);
  const results = await Promise.allSettled([
    ...limitedQueries.map((query) => naverNews(query, 5)),
    ...limitedQueries.map((query) => bingNews(query, 5)),
  ]);
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value || []) {
      const key = `${item.title}|${item.link}`.toLowerCase();
      if (seen.has(key) || !isRelevant(item, terms, "domestic")) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= 3) return items;
    }
  }
  return items;
}

async function collectOverseasFallback(portfolio, terms) {
  const holdings = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
  const symbols = holdings
    .filter((item) => item.market !== "KR")
    .map((item) => String(item.symbol || "").trim())
    .filter(Boolean);
  const fallbackSymbols = symbols.length ? symbols : ["QQQM", "VOO"];
  const seen = new Set();
  const items = [];
  const results = await Promise.allSettled([...new Set(fallbackSymbols)].slice(0, 6).map((symbol) => yahooFinanceNews(symbol, 5)));
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value || []) {
      const key = `${item.title}|${item.link}`.toLowerCase();
      if (seen.has(key) || !isRelevant(item, terms, "overseas")) continue;
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
    let [domestic, overseas] = await Promise.all([
      collectNews(queries.domesticQueries, { hl: "ko", gl: "KR", ceid: "KR:ko" }, queries.domesticTerms, "domestic"),
      collectNews(queries.overseasQueries, { hl: "en", gl: "US", ceid: "US:en" }, queries.overseasTerms, "overseas"),
    ]);
    if (domestic.length < 3) {
      const fallback = await collectDomesticFallback(queries.domesticQueries, queries.domesticTerms);
      domestic = [...domestic, ...fallback].filter((item, index, list) => list.findIndex((other) => other.title === item.title) === index).slice(0, 3);
    }
    if (overseas.length < 3) {
      const fallback = await collectOverseasFallback(portfolio, queries.overseasTerms);
      overseas = [...overseas, ...fallback].filter((item, index, list) => list.findIndex((other) => other.title === item.title) === index).slice(0, 3);
    }
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
