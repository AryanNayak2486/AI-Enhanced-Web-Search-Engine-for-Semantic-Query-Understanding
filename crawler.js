const axios = require("axios");
const cheerio = require("cheerio");
const db = require("./db");
const { indexPage } = require("./indexer");
const { runPageRank } = require("./pagerank");

const CRAWL_DELAY_MS = 600; // ms between requests (be polite)
const PAGERANK_EVERY = 75; // run PageRank every N crawled pages
const SEED_EVERY_MS = 15 * 60 * 1000; // re-seed every 15 min
const MAX_LINKS_SAVED = 40; // outbound links to store per page
const MAX_LINKS_ENQUEUED = 8; // links to enqueue per page

let crawledCount = 0;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
};

// ── Queue helpers ────────────────────────────────────────────────────
const stmtEnqueue = db.prepare(`
  INSERT OR IGNORE INTO crawl_queue (url, priority, status, next_attempt)
  VALUES (?, ?, 'pending', datetime('now'))
`);

function enqueue(url, priority = 0.4) {
  try {
    // Skip non-http, images, PDFs, etc.
    if (!url.startsWith("http")) return;
    if (/\.(jpg|jpeg|png|gif|webp|svg|mp4|pdf|zip|exe)(\?|$)/i.test(url))
      return;
    stmtEnqueue.run(url, priority);
  } catch {}
}

// ── Dynamic seed sources ─────────────────────────────────────────────

async function seedHackerNews() {
  try {
    const { data: ids } = await axios.get(
      "https://hacker-news.firebaseio.com/v0/topstories.json",
      { timeout: 8000 },
    );
    const top = ids.slice(0, 30);
    let added = 0;
    for (const id of top) {
      try {
        const { data } = await axios.get(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
          { timeout: 5000 },
        );
        if (data?.url) {
          enqueue(data.url, 0.9);
          added++;
        }
      } catch {}
    }
    console.log(`[Seed/HN] ${added} URLs queued`);
  } catch (e) {
    console.error(`[Seed/HN] Failed — ${e.message}`);
  }
}

async function seedReddit() {
  const subs = [
    "technology",
    "worldnews",
    "science",
    "programming",
    "MachineLearning",
    "gaming",
    "movies",
    "finance",
    "nba",
    "formula1",
    "Cricket",
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
          enqueue(url, 0.85);
          added++;
        }
      }
    } catch {}
  }
  console.log(`[Seed/Reddit] ${added} URLs queued`);
}

async function seedWikipediaRandom(count = 15) {
  let added = 0;
  for (let i = 0; i < count; i++) {
    try {
      const { data } = await axios.get(
        "https://en.wikipedia.org/api/rest_v1/page/random/summary",
        { timeout: 6000 },
      );
      const url = data?.content_urls?.desktop?.page;
      if (url) {
        enqueue(url, 0.7);
        added++;
      }
    } catch {}
    await sleep(200);
  }
  console.log(`[Seed/Wikipedia] ${added} random articles queued`);
}

async function seedWikipediaTrending() {
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

    const skip = ["Main_Page", "Special:", "Wikipedia:", "Portal:", "File:"];
    let added = 0;
    for (const a of (data?.items?.[0]?.articles || []).slice(0, 20)) {
      if (skip.some((s) => a.article.startsWith(s))) continue;
      enqueue(`https://en.wikipedia.org/wiki/${a.article}`, 0.8);
      added++;
    }
    console.log(`[Seed/Wikipedia Trending] ${added} articles queued`);
  } catch (e) {
    console.error(`[Seed/Wikipedia Trending] Failed — ${e.message}`);
  }
}

async function runSeeding() {
  console.log("\n🌱 Seeding crawl queue...\n");
  await Promise.allSettled([
    seedHackerNews(),
    seedReddit(),
    seedWikipediaRandom(),
    seedWikipediaTrending(),
  ]);
  console.log("\n✅ Seeding complete\n");
}

// ── Crawl one page ───────────────────────────────────────────────────
async function crawlOne(url) {
  db.prepare(`UPDATE crawl_queue SET status = 'crawling' WHERE url = ?`).run(
    url,
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
      db.prepare(`DELETE FROM crawl_queue WHERE url = ?`).run(url);
      return;
    }

    let domain = "";
    try {
      domain = new URL(url).hostname;
    } catch {}

    const snippet = fullText.slice(0, 300);
    const wordCount = fullText.split(" ").length;

    // Upsert page
    db.prepare(
      `
      INSERT INTO pages (url, domain, title, snippet, full_text, word_count, crawled_at, next_crawl)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+24 hours'))
      ON CONFLICT(url) DO UPDATE SET
        title      = excluded.title,
        snippet    = excluded.snippet,
        full_text  = excluded.full_text,
        word_count = excluded.word_count,
        crawled_at = excluded.crawled_at,
        next_crawl = excluded.next_crawl
    `,
    ).run(url, domain, title, snippet, fullText, wordCount);

    const pageId = db.prepare(`SELECT id FROM pages WHERE url = ?`).get(url).id;

    // Extract links
    const links = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href?.startsWith("http")) links.push(href);
    });

    // Save outbound links to DB (for PageRank)
    db.prepare(`DELETE FROM links WHERE source_id = ?`).run(pageId);
    const insertLink = db.prepare(
      `INSERT OR IGNORE INTO links (source_id, target_url) VALUES (?, ?)`,
    );
    const insertLinks = db.transaction((pid, ls) => {
      for (const l of ls) insertLink.run(pid, l);
    });
    insertLinks(pageId, links.slice(0, MAX_LINKS_SAVED));

    // Enqueue discovered links
    for (const link of links.slice(0, MAX_LINKS_ENQUEUED)) {
      enqueue(link, 0.4);
    }

    // Real-time index
    indexPage(pageId, fullText);

    // Mark done + schedule re-crawl
    db.prepare(
      `
      INSERT OR REPLACE INTO crawl_queue (url, priority, status, next_attempt)
      VALUES (?, 0.5, 'pending', datetime('now', '+24 hours'))
    `,
    ).run(url);

    crawledCount++;
    console.log(`[✓] #${crawledCount} "${title.slice(0, 60)}" | ${domain}`);

    if (crawledCount % PAGERANK_EVERY === 0) {
      console.log("\n⚙  Running PageRank...");
      runPageRank();
    }
  } catch (err) {
    const attempts =
      (db.prepare(`SELECT attempts FROM crawl_queue WHERE url = ?`).get(url)
        ?.attempts || 0) + 1;
    const backoffMin = Math.min(attempts * 10, 120);
    db.prepare(
      `
      UPDATE crawl_queue
      SET status = 'pending', attempts = ?, next_attempt = datetime('now', '+' || ? || ' minutes')
      WHERE url = ?
    `,
    ).run(attempts, backoffMin, url);
    console.error(`[✗] ${url.slice(0, 80)} — ${err.message}`);
  }
}

// ── Main crawl loop ──────────────────────────────────────────────────
async function crawlLoop() {
  while (true) {
    const row = db
      .prepare(
        `
      SELECT url FROM crawl_queue
      WHERE status = 'pending'
        AND next_attempt <= datetime('now')
        AND attempts < 5
      ORDER BY priority DESC
      LIMIT 1
    `,
      )
      .get();

    if (row) {
      await crawlOne(row.url);
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

// ── Start ────────────────────────────────────────────────────────────
(async () => {
  console.log("🕷  Crawler starting...\n");

  // Initial seed
  await runSeeding();

  // Periodic re-seeding
  setInterval(runSeeding, SEED_EVERY_MS);

  // Start crawl loop
  crawlLoop().catch(console.error);
})();
