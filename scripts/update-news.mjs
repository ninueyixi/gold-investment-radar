import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

const sources = [
  {
    name: "Federal Reserve",
    scope: "global",
    url: "https://www.federalreserve.gov/feeds/press_all.xml"
  },
  {
    name: "Federal Reserve Monetary Policy",
    scope: "global",
    url: "https://www.federalreserve.gov/feeds/press_monetary.xml"
  },
  {
    name: "BLS Latest Numbers",
    scope: "global",
    url: "https://www.bls.gov/feed/bls_latest.rss"
  },
  {
    name: "Google News Gold Macro",
    scope: "global",
    url: "https://news.google.com/rss/search?q=gold%20(Federal%20Reserve%20OR%20dollar%20OR%20yields%20OR%20inflation)&hl=en-US&gl=US&ceid=US:en"
  },
  {
    name: "Google News China Gold",
    scope: "china",
    url: "https://news.google.com/rss/search?q=%E9%BB%84%E9%87%91%20(%E4%BA%BA%E6%B0%91%E5%B8%81%20OR%20%E4%B8%8A%E6%B5%B7%E9%87%91%20OR%20%E5%A4%AE%E8%A1%8C%E8%B4%AD%E9%87%91%20OR%20%E9%BB%84%E9%87%91%E5%82%A8%E5%A4%87)&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
  }
];

const rules = [
  {
    pattern: /(rate cut|cut rates|dovish|降息|宽松|鸽派|实际利率下行|避险|geopolitical|war|conflict|通胀|inflation)/i,
    impact: "bullish",
    weight: 3,
    reason: "新闻涉及降息、通胀、避险或地缘风险，通常会降低持有黄金的机会成本或提升避险需求。"
  },
  {
    pattern: /(rate hike|higher rates|hawkish|strong dollar|yields rise|加息|鹰派|美元走强|收益率上升|实际利率上升)/i,
    impact: "bearish",
    weight: 3,
    reason: "新闻涉及加息、美元走强或收益率上升，通常会提高持有黄金的机会成本，对金价形成压力。"
  },
  {
    pattern: /(central bank gold|gold reserves|央行购金|黄金储备|上海金|人民币|CNY|yuan|汇率|溢价)/i,
    impact: "bullish",
    weight: 2,
    reason: "新闻涉及央行购金、人民币汇率或国内黄金溢价，可能影响国内黄金需求和人民币计价表现。"
  }
];

function todayInShanghai() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

function stripTags(value = "") {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value = "") {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function getTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeEntities(stripTags(match?.[1] ?? ""));
}

function parseFeed(xml, source) {
  const items = [...xml.matchAll(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi)].slice(0, 20);
  return items.map((match) => {
    const item = match[0];
    const title = getTag(item, "title");
    const link = getTag(item, "link") || item.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || source.url;
    const publishedAt = getTag(item, "pubDate") || getTag(item, "updated") || getTag(item, "published");
    const summary = getTag(item, "description") || getTag(item, "summary");

    return {
      title,
      source: source.name,
      url: link,
      publishedAt: Number.isNaN(Date.parse(publishedAt)) ? new Date().toISOString() : new Date(publishedAt).toISOString(),
      scope: source.scope,
      summary
    };
  }).filter((item) => item.title);
}

function analyze(item) {
  const text = `${item.title} ${item.summary}`;
  const hits = rules.filter((rule) => rule.pattern.test(text));
  const score = hits.reduce((total, rule) => total + rule.weight, 0);
  const strongest = hits[0];
  const hasChinaSignal = /央行购金|黄金储备|上海金|人民币|CNY|yuan|汇率|溢价/i.test(text);
  const hasGlobalSignal = /Federal Reserve|Fed|dollar|yield|inflation|rate|美联储|美元|收益率|通胀|地缘|避险/i.test(text);

  return {
    id: `${item.source}-${item.title}`.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").slice(0, 96),
    title: item.title,
    source: item.source,
    url: item.url,
    publishedAt: item.publishedAt,
    priority: score >= 3 ? "high" : score >= 2 ? "medium" : "low",
    impact: strongest?.impact ?? "neutral",
    scope: hasChinaSignal && hasGlobalSignal ? "both" : item.scope,
    reason: strongest?.reason ?? "暂未命中明确的黄金影响规则，建议作为低优先级市场背景信息观察。"
  };
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "GoldInvestmentRadar/1.0"
      }
    });

    if (!response.ok) throw new Error(`${source.name} returned ${response.status}`);
    const text = await response.text();
    return parseFeed(text, source);
  } catch (error) {
    console.warn(`跳过 ${source.name}: ${error.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(await readFile(filePath, "utf8"));
}

function sortNews(news) {
  const priorityScore = { high: 3, medium: 2, low: 1 };
  return news.sort((a, b) => {
    const byPriority = priorityScore[b.priority] - priorityScore[a.priority];
    if (byPriority !== 0) return byPriority;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });
}

function fallbackNews(date) {
  const generatedAt = new Date().toISOString();
  return [
    {
      id: `fallback-${date}`,
      title: "今日暂未抓取到公开新闻源更新",
      source: "系统提示",
      url: "https://www.federalreserve.gov/",
      publishedAt: generatedAt,
      priority: "low",
      impact: "neutral",
      scope: "both",
      reason: "公开新闻源可能暂时不可用或尚未发布新内容；建议稍后重新运行更新脚本，或手动查看重点财经日历。"
    }
  ];
}

async function main() {
  const date = todayInShanghai();
  const generatedAt = new Date().toISOString();
  const fetched = (await Promise.all(sources.map(fetchSource))).flat();
  const unique = new Map();

  for (const item of fetched.map(analyze)) {
    if (!unique.has(item.id)) unique.set(item.id, item);
  }

  const news = sortNews([...unique.values()]).slice(0, 24);
  const daily = {
    date,
    generatedAt,
    news: news.length > 0 ? news : fallbackNews(date)
  };

  const dataDir = path.join(root, "data");
  const archiveDir = path.join(dataDir, "archive");
  const historyPath = path.join(dataDir, "history.json");
  const previousHistory = await readJson(historyPath, []);
  const summary = {
    date,
    total: daily.news.length,
    highPriority: daily.news.filter((item) => item.priority === "high").length,
    bullish: daily.news.filter((item) => item.impact === "bullish").length,
    bearish: daily.news.filter((item) => item.impact === "bearish").length,
    neutral: daily.news.filter((item) => item.impact === "neutral").length
  };
  const history = [summary, ...previousHistory.filter((item) => item.date !== date)].slice(0, 30);

  if (dryRun) {
    console.log(JSON.stringify({ daily, history: history.slice(0, 3) }, null, 2));
    return;
  }

  await mkdir(archiveDir, { recursive: true });
  await writeFile(path.join(dataDir, "daily.json"), `${JSON.stringify(daily, null, 2)}\n`);
  await writeFile(path.join(archiveDir, `${date}.json`), `${JSON.stringify(daily, null, 2)}\n`);
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
  console.log(`已生成 ${daily.news.length} 条黄金新闻：${date}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
