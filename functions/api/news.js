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

function parseRssItems(xml = "") {
  const items = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
    const source = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "";
    if (!title || !link) continue;
    items.push({
      title: stripPublisher(title),
      title_ko: stripPublisher(title),
      link: decodeXml(link).trim(),
      source: decodeXml(source).trim(),
    });
  }
  return items;
}

async function googleNews(query, { hl = "ko", gl = "KR", ceid = "KR:ko", limit = 3 } = {}) {
  const today = kstDate();
  const tomorrow = kstDate(1);
  const rssQuery = `${query} when:1d after:${today} before:${tomorrow}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(rssQuery)}&hl=${hl}&gl=${gl}&ceid=${ceid}&scoring=n`;
  const response = await fetch(url, { headers: { "user-agent": "Briefolio/1.0" } });
  if (!response.ok) return [];
  return parseRssItems(await response.text()).slice(0, limit);
}

function holdingsQueries(portfolio) {
  const holdings = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
  const domestic = holdings
    .filter((item) => item.market === "KR")
    .map((item) => item.name || item.symbol)
    .filter(Boolean);
  const overseas = holdings
    .filter((item) => item.market !== "KR")
    .map((item) => item.name || item.symbol)
    .filter(Boolean);
  return {
    domestic: domestic.length ? domestic : ["삼성전자"],
    overseas: overseas.length ? overseas : ["QQQM VOO"],
  };
}

async function collectNews(queries, options) {
  const seen = new Set();
  const items = [];
  for (const query of queries) {
    const found = await googleNews(query, { ...options, limit: 5 });
    for (const item of found) {
      const key = item.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= 3) return items;
    }
  }
  return items;
}

export async function onRequestGet({ env }) {
  try {
    // PORTFOLIO_CONFIG_URL 문제로 포트폴리오를 못 읽어도 뉴스 섹션은 비워두지 않는다.
    const portfolio = await fetchPortfolio(env).catch(() => defaultPortfolio());
    const queries = holdingsQueries(portfolio);
    const [domestic, overseas] = await Promise.all([
      collectNews([...queries.domestic, "코스피 삼성전자 네이버"], { hl: "ko", gl: "KR", ceid: "KR:ko" }),
      collectNews([...queries.overseas, "QQQM VOO Apple NVIDIA stock"], { hl: "en", gl: "US", ceid: "US:en" }),
    ]);
    return json({
      domestic,
      overseas,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json({ domestic: [], overseas: [], error: error.message });
  }
}
