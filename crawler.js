const axios = require("axios");
const cheerio = require("cheerio");
const { pool, init } = require("./db");
const { indexPage } = require("./indexer");
const { runPageRank } = require("./pagerank");

const CRAWL_DELAY_MS = 700;
const PAGERANK_EVERY = 75;
const SEED_EVERY_MS = 15 * 60 * 1000;
const MAX_LINKS_SAVED = 40;
const MAX_LINKS_QUEUE = 8;

let crawledCount = 0;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
};

async function enqueue(url, priority = 0.4) {
  try {
    if (!url.startsWith("http")) return;
    if (
      /\.(jpg|jpeg|png|gif|webp|svg|mp4|pdf|zip|exe|css|js|woff|woff2)(\?|$)/i.test(
        url,
      )
    )
      return;
    await pool.query(
      `INSERT INTO crawl_queue (url, priority, status, next_attempt)
       VALUES ($1, $2, 'pending', NOW())
       ON CONFLICT (url) DO NOTHING`,
      [url, priority],
    );
  } catch {}
}

// ── Hacker News ──────────────────────────────────────────────────────
async function seedHackerNews() {
  let added = 0;
  try {
    for (const feed of [
      "topstories",
      "beststories",
      "newstories",
      "askstories",
      "showstories",
    ]) {
      const { data: ids } = await axios.get(
        `https://hacker-news.firebaseio.com/v0/${feed}.json`,
        { timeout: 8000 },
      );
      for (const id of ids.slice(0, 20)) {
        try {
          const { data } = await axios.get(
            `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
            { timeout: 5000 },
          );
          if (data?.url) {
            await enqueue(data.url, 0.9);
            added++;
          }
        } catch {}
      }
    }
    console.log(`[Seed/HN] ${added} URLs queued`);
  } catch (e) {
    console.error(`[Seed/HN] ${e.message}`);
  }
}

// ── Reddit ───────────────────────────────────────────────────────────
async function seedReddit() {
  const subs = [
    "technology",
    "programming",
    "compsci",
    "MachineLearning",
    "artificial",
    "webdev",
    "learnprogramming",
    "opensource",
    "cybersecurity",
    "netsec",
    "devops",
    "linux",
    "python",
    "javascript",
    "rust",
    "worldnews",
    "geopolitics",
    "news",
    "UpliftingNews",
    "europe",
    "india",
    "china",
    "MiddleEast",
    "environment",
    "climate",
    "science",
    "Physics",
    "biology",
    "chemistry",
    "space",
    "astronomy",
    "neuroscience",
    "medicine",
    "askscience",
    "investing",
    "stocks",
    "CryptoCurrency",
    "economics",
    "personalfinance",
    "wallstreetbets",
    "financialindependence",
    "nba",
    "nfl",
    "soccer",
    "Cricket",
    "formula1",
    "tennis",
    "olympics",
    "baseball",
    "hockey",
    "MMA",
    "gaming",
    "pcgaming",
    "PS5",
    "XboxSeriesX",
    "NintendoSwitch",
    "indiegaming",
    "gamedev",
    "movies",
    "television",
    "Music",
    "books",
    "anime",
    "Documentaries",
    "LifeProTips",
    "todayilearned",
    "explainlikeimfive",
    "AskReddit",
    "Futurology",
    "history",
    "philosophy",
  ];

  let added = 0;
  for (const sub of subs) {
    try {
      const { data } = await axios.get(
        `https://www.reddit.com/r/${sub}/top.json?t=day&limit=10`,
        { timeout: 8000, headers: { "User-Agent": "search-engine/1.0" } },
      );
      for (const post of data?.data?.children || []) {
        const url = post?.data?.url;
        if (
          url &&
          !url.includes("reddit.com") &&
          !/\.(jpg|jpeg|png|gif|webp|mp4)$/i.test(url)
        ) {
          await enqueue(url, 0.85);
          added++;
        }
      }
    } catch {}
    await sleep(150);
  }
  console.log(`[Seed/Reddit] ${added} URLs queued`);
}

// ── Wikipedia ────────────────────────────────────────────────────────
async function seedWikipedia() {
  let added = 0;
  for (let i = 0; i < 20; i++) {
    try {
      const { data } = await axios.get(
        "https://en.wikipedia.org/api/rest_v1/page/random/summary",
        { timeout: 6000 },
      );
      const url = data?.content_urls?.desktop?.page;
      if (url) {
        await enqueue(url, 0.7);
        added++;
      }
    } catch {}
    await sleep(150);
  }
  try {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const { data } = await axios.get(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${y}/${m}/${day}`,
      { timeout: 8000 },
    );
    const skip = [
      "Main_Page",
      "Special:",
      "Wikipedia:",
      "Portal:",
      "File:",
      "Help:",
    ];
    for (const a of (data?.items?.[0]?.articles || []).slice(0, 30)) {
      if (skip.some((s) => a.article.startsWith(s))) continue;
      await enqueue(`https://en.wikipedia.org/wiki/${a.article}`, 0.8);
      added++;
    }
  } catch {}
  console.log(`[Seed/Wikipedia] ${added} URLs queued`);
}

// ── Direct URL seeds ─────────────────────────────────────────────────
async function seedDirectUrls() {
  const urls = [
    // News
    "https://apnews.com",
    "https://apnews.com/hub/technology",
    "https://apnews.com/hub/world-news",
    "https://apnews.com/hub/science",
    "https://apnews.com/hub/sports",
    "https://www.bbc.com/news",
    "https://www.bbc.com/sport",
    "https://www.bbc.com/future",
    "https://www.reuters.com",
    "https://www.aljazeera.com",
    "https://thehill.com",
    "https://www.politico.com",
    // Tech
    "https://techcrunch.com",
    "https://arstechnica.com",
    "https://www.theverge.com",
    "https://www.wired.com",
    "https://www.technologyreview.com",
    "https://venturebeat.com",
    "https://www.zdnet.com",
    "https://www.engadget.com",
    "https://news.ycombinator.com",
    "https://news.ycombinator.com/best",
    "https://news.ycombinator.com/ask",
    "https://news.ycombinator.com/show",
    "https://github.com/trending",
    "https://github.com/trending/python",
    "https://github.com/trending/javascript",
    "https://github.com/trending/typescript",
    // Science
    "https://www.sciencedaily.com",
    "https://www.scientificamerican.com",
    "https://phys.org",
    "https://www.newscientist.com",
    "https://www.space.com",
    // Finance
    "https://finance.yahoo.com",
    "https://www.marketwatch.com",
    "https://www.investopedia.com",
    "https://www.coindesk.com",
    // Sports
    "https://www.espn.com",
    "https://www.espn.com/nba",
    "https://www.espn.com/nfl",
    "https://www.espn.com/soccer",
    "https://www.cricbuzz.com",
    // Dev blogs
    "https://dev.to",
    "https://blog.cloudflare.com",
    "https://engineering.fb.com",
    "https://netflixtechblog.com",
    "https://aws.amazon.com/blogs/aws",
    // Wikipedia portals
    "https://en.wikipedia.org/wiki/Portal:Current_events",
    "https://en.wikipedia.org/wiki/Portal:Technology",
    "https://en.wikipedia.org/wiki/Portal:Science",
    "https://en.wikipedia.org/wiki/Portal:Sports",
  ];
  let added = 0;
  for (const url of urls) {
    await enqueue(url, 0.8);
    added++;
  }
  console.log(`[Seed/Direct] ${added} URLs queued`);
}

async function runSeeding() {
  console.log("\n🌱 Seeding crawl queue...");
  await Promise.allSettled([
    seedHackerNews(),
    seedReddit(),
    seedWikipedia(),
    seedDirectUrls(),
  ]);
  console.log("✅ Seeding done\n");
}

// ── Crawl one page ───────────────────────────────────────────────────
async function crawlOne(url) {
  await pool.query(
    `UPDATE crawl_queue SET status = 'crawling' WHERE url = $1`,
    [url],
  );
  try {
    const { data: html } = await axios.get(url, {
      timeout: 12000,
      headers: HEADERS,
      maxRedirects: 5,
    });
    const $ = cheerio.load(html);
    $(
      "script,style,nav,footer,header,noscript,aside,.ad,.sidebar,.cookie-banner",
    ).remove();

    const title = $("title").text().trim() || "Untitled";
    const fullText = $("body").text().replace(/\s+/g, " ").trim();

    if (fullText.length < 150) {
      await pool.query(`DELETE FROM crawl_queue WHERE url = $1`, [url]);
      return;
    }

    let domain = "";
    try {
      domain = new URL(url).hostname;
    } catch {}

    const { rows } = await pool.query(
      `INSERT INTO pages (url, domain, title, snippet, full_text, word_count, crawled_at, next_crawl)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW() + INTERVAL '24 hours')
       ON CONFLICT(url) DO UPDATE SET
         title=EXCLUDED.title, snippet=EXCLUDED.snippet,
         full_text=EXCLUDED.full_text, word_count=EXCLUDED.word_count,
         crawled_at=NOW(), next_crawl=NOW() + INTERVAL '24 hours'
       RETURNING id`,
      [
        url,
        domain,
        title,
        fullText.slice(0, 300),
        fullText,
        fullText.split(" ").length,
      ],
    );

    const pageId = rows[0].id;
    const links = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href?.startsWith("http")) links.push(href);
    });

    await pool.query(`DELETE FROM links WHERE source_id = $1`, [pageId]);
    for (const link of links.slice(0, MAX_LINKS_SAVED)) {
      try {
        await pool.query(
          `INSERT INTO links (source_id, target_url) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [pageId, link],
        );
      } catch {}
    }

    for (const link of links.slice(0, MAX_LINKS_QUEUE))
      await enqueue(link, 0.4);
    await indexPage(pageId, fullText);

    await pool.query(
      `INSERT INTO crawl_queue (url, priority, status, next_attempt)
       VALUES ($1, 0.5, 'pending', NOW() + INTERVAL '24 hours')
       ON CONFLICT(url) DO UPDATE SET status='pending', next_attempt=NOW() + INTERVAL '24 hours'`,
      [url],
    );

    crawledCount++;
    console.log(`[✓] #${crawledCount} "${title.slice(0, 60)}" | ${domain}`);

    if (crawledCount % PAGERANK_EVERY === 0) {
      console.log("⚙  Running PageRank...");
      await runPageRank();
    }
  } catch (err) {
    const { rows } = await pool.query(
      `SELECT attempts FROM crawl_queue WHERE url = $1`,
      [url],
    );
    const attempts = (rows[0]?.attempts || 0) + 1;
    await pool.query(
      `UPDATE crawl_queue SET status='pending', attempts=$1, next_attempt=NOW() + ($2 || ' minutes')::INTERVAL WHERE url=$3`,
      [attempts, Math.min(attempts * 10, 120), url],
    );
    console.error(`[✗] ${url.slice(0, 80)} — ${err.message}`);
  }
}

async function crawlLoop() {
  while (true) {
    const { rows } = await pool.query(`
      SELECT url FROM crawl_queue
      WHERE status = 'pending' AND next_attempt <= NOW() AND attempts < 5
      ORDER BY priority DESC LIMIT 1
    `);
    if (rows.length) {
      await crawlOne(rows[0].url);
    } else {
      console.log("\n[Queue empty] Re-seeding...");
      await runSeeding();
    }
    await sleep(CRAWL_DELAY_MS);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log("🕷  Crawler starting...\n");
  await init();
  await runSeeding();
  setInterval(runSeeding, SEED_EVERY_MS);
  crawlLoop().catch(console.error);
})();
