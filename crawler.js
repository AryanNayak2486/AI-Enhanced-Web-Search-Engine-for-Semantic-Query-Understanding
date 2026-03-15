const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const visited = new Set();

async function crawlPage(url, depth = 0, maxDepth = 1) {
  if (visited.has(url) || depth > maxDepth) return;
  visited.add(url);

  console.log(`[Crawling] ${url}`);

  try {
    const { data: html } = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
      },
    });

    const $ = cheerio.load(html);
    $(
      "script, style, nav, footer, header, noscript, aside, .ad, .advertisement, .sidebar",
    ).remove();

    const title = $("title").text().trim() || "Untitled";
    const rawText = $("body").text().replace(/\s+/g, " ").trim();

    if (rawText.length < 100) {
      console.log(`[Skipped] Too short — ${url}`);
      return;
    }

    const doc = {
      url,
      title,
      text: rawText,
      crawledAt: new Date().toISOString(),
    };
    const fileName = url.replace(/[^a-z0-9]/gi, "_").slice(0, 80) + ".json";
    fs.writeFileSync(
      path.join(DATA_DIR, fileName),
      JSON.stringify(doc, null, 2),
    );
    console.log(`[Saved] "${title}" (${rawText.length} chars)`);

    if (depth < maxDepth) {
      const links = [];
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (href && href.startsWith("http")) links.push(href);
      });
      for (const link of links.slice(0, 5)) {
        await crawlPage(link, depth + 1, maxDepth);
      }
    }
  } catch (err) {
    console.error(`[Error] ${url} — ${err.message}`);
  }
}

async function startCrawl(seedUrls) {
  console.log(`\nStarting crawl with ${seedUrls.length} seed URLs...\n`);
  for (const url of seedUrls) {
    await crawlPage(url);
  }
  console.log(`\nDone! Crawled ${visited.size} pages. Data saved in /data`);
}

const SEED_URLS = [
  // ── Wikipedia (reliable, no blocking) ───────────────────────────
  "https://en.wikipedia.org/wiki/Russo-Ukrainian_War",
  "https://en.wikipedia.org/wiki/Israel%E2%80%93Hamas_war",
  "https://en.wikipedia.org/wiki/ChatGPT",
  "https://en.wikipedia.org/wiki/Nvidia",
  "https://en.wikipedia.org/wiki/Bitcoin",
  "https://en.wikipedia.org/wiki/Grand_Theft_Auto_VI",
  "https://en.wikipedia.org/wiki/Esports",
  "https://en.wikipedia.org/wiki/Indian_Premier_League",
  "https://en.wikipedia.org/wiki/Formula_One",
  "https://en.wikipedia.org/wiki/FIFA_World_Cup",

  // ── Reddit (public, no login needed for these) ───────────────────
  // Gaming subreddits
  "https://old.reddit.com/r/gaming/top/?t=week",
  "https://old.reddit.com/r/pcgaming/top/?t=week",
  "https://old.reddit.com/r/PS5/top/?t=week",

  // Tech subreddits
  "https://old.reddit.com/r/technology/top/?t=week",
  "https://old.reddit.com/r/artificial/top/?t=week",
  "https://old.reddit.com/r/MachineLearning/top/?t=week",

  // News & geopolitics
  "https://old.reddit.com/r/worldnews/top/?t=week",
  "https://old.reddit.com/r/geopolitics/top/?t=week",

  // Sports
  "https://old.reddit.com/r/soccer/top/?t=week",
  "https://old.reddit.com/r/Cricket/top/?t=week",
  "https://old.reddit.com/r/nba/top/?t=week",
  "https://old.reddit.com/r/formula1/top/?t=week",

  // ── Hacker News (tech, no blocking) ─────────────────────────────
  "https://news.ycombinator.com/news",
  "https://news.ycombinator.com/best",

  // ── RSS feeds rendered as HTML (usually no blocking) ────────────
  "https://feeds.feedburner.com/TechCrunch",
  "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
  "https://feeds.arstechnica.com/arstechnica/index",

  // ── Open access news ─────────────────────────────────────────────
  "https://apnews.com/hub/technology",
  "https://apnews.com/hub/sports",
  "https://apnews.com/hub/world-news",
];

startCrawl(SEED_URLS);
