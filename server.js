const express = require("express");
const path = require("path");
const db = require("./db");
const { tokenize } = require("./indexer");

const app = express();
app.use(express.json());

// ── Smart snippet with term highlighting ─────────────────────────────
function getSnippet(fullText, queryTokens, maxLen = 350) {
  if (!fullText) return "";

  // Split into chunks of ~150 chars (roughly sentences)
  const chunks = fullText.match(/[^.!?\n]{20,}[.!?\n]?/g) || [
    fullText.slice(0, maxLen),
  ];

  // Score each chunk by how many query tokens it contains
  const scored = chunks.map((c) => ({
    c,
    score: queryTokens.filter((t) => c.toLowerCase().includes(t)).length,
  }));
  scored.sort((a, b) => b.score - a.score);

  let snippet = scored
    .slice(0, 2)
    .map((x) => x.c.trim())
    .join(" … ")
    .slice(0, maxLen);

  // Wrap matching terms in <mark>
  for (const token of queryTokens) {
    try {
      snippet = snippet.replace(
        new RegExp(`(${token}\\w*)`, "gi"),
        "<mark>$1</mark>",
      );
    } catch {}
  }

  return snippet;
}

// ── Search ───────────────────────────────────────────────────────────
function search({ q, page = 1, pageSize = 10, domain, from, to }) {
  const tokens = tokenize(q);
  if (!tokens.length)
    return { results: [], total: 0, page, pageSize, tokens: [] };

  const totalDocs = db.prepare("SELECT COUNT(*) as c FROM pages").get().c || 1;

  // Fetch TF rows for all query tokens
  const placeholders = tokens.map(() => "?").join(",");
  const termRows = db
    .prepare(
      `
    SELECT
      t.term, t.doc_id, t.tf,
      (SELECT COUNT(DISTINCT doc_id) FROM terms WHERE term = t.term) AS df
    FROM terms t
    WHERE t.term IN (${placeholders})
  `,
    )
    .all(...tokens);

  // Compute TF-IDF per doc
  const scores = {};
  for (const row of termRows) {
    const idf = Math.log((totalDocs + 1) / (row.df + 1)) + 1;
    scores[row.doc_id] = (scores[row.doc_id] || 0) + row.tf * idf;
  }

  if (!Object.keys(scores).length) {
    return { results: [], total: 0, page, pageSize, tokens };
  }

  // Fetch page metadata for candidate docs
  const docIds = Object.keys(scores);
  const idPlaceholders = docIds.map(() => "?").join(",");

  let filterSQL = "";
  const filterParams = [...docIds];
  if (domain) {
    filterSQL += " AND domain = ?";
    filterParams.push(domain);
  }
  if (from) {
    filterSQL += " AND crawled_at >= ?";
    filterParams.push(from);
  }
  if (to) {
    filterSQL += " AND crawled_at <= ?";
    filterParams.push(to);
  }

  const pages = db
    .prepare(
      `
    SELECT id, url, domain, title, snippet, full_text, crawled_at, pagerank
    FROM pages
    WHERE id IN (${idPlaceholders}) ${filterSQL}
  `,
    )
    .all(...filterParams);

  // Final scoring: TF-IDF × PageRank boost
  const ranked = pages
    .map((p) => ({
      ...p,
      finalScore: (scores[p.id] || 0) * (1 + Math.log(1 + p.pagerank)),
    }))
    .sort((a, b) => b.finalScore - a.finalScore);

  const total = ranked.length;
  const paged = ranked.slice((page - 1) * pageSize, page * pageSize);

  const results = paged.map((r) => ({
    url: r.url,
    domain: r.domain,
    title: r.title,
    snippet: getSnippet(r.full_text || r.snippet, tokens),
    crawled_at: r.crawled_at,
    pagerank: parseFloat(r.pagerank.toFixed(2)),
    score: r.finalScore.toFixed(4),
  }));

  return { results, total, page, pageSize, tokens, mode: "tfidf+pagerank" };
}

// ── Routes ───────────────────────────────────────────────────────────

app.get("/search", (req, res) => {
  const { q, page = 1, pageSize = 10, domain, from, to } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: "Missing ?q=" });

  // Log query for autocomplete
  db.prepare(
    `
    INSERT INTO queries (query, frequency, searched_at) VALUES (?, 1, datetime('now'))
    ON CONFLICT(query) DO UPDATE SET
      frequency   = frequency + 1,
      searched_at = datetime('now')
  `,
  ).run(q.trim().toLowerCase());

  try {
    res.json(search({ q, page: +page, pageSize: +pageSize, domain, from, to }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/autocomplete", (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ suggestions: [] });

  const prefix = q.toLowerCase();
  const pattern = `${prefix}%`;

  const fromQueries = db
    .prepare(
      `
    SELECT query AS text, frequency AS score
    FROM queries
    WHERE query LIKE ?
    ORDER BY frequency DESC
    LIMIT 5
  `,
    )
    .all(pattern);

  const fromTitles = db
    .prepare(
      `
    SELECT title AS text, pagerank AS score
    FROM pages
    WHERE lower(title) LIKE ?
    ORDER BY pagerank DESC
    LIMIT 5
  `,
    )
    .all(`%${prefix}%`);

  const seen = new Set();
  const suggestions = [...fromQueries, ...fromTitles]
    .filter(
      (s) =>
        s.text &&
        !seen.has(s.text.toLowerCase()) &&
        seen.add(s.text.toLowerCase()),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((s) => s.text);

  res.json({ suggestions });
});

app.get("/stats", (req, res) => {
  const pages = db.prepare("SELECT COUNT(*) AS c FROM pages").get().c;
  const queued = db
    .prepare("SELECT COUNT(*) AS c FROM crawl_queue WHERE status = 'pending'")
    .get().c;
  const terms = db
    .prepare("SELECT COUNT(DISTINCT term) AS c FROM terms")
    .get().c;
  const domains = db
    .prepare("SELECT COUNT(DISTINCT domain) AS c FROM pages")
    .get().c;
  const topDomains = db
    .prepare(
      `
    SELECT domain, COUNT(*) AS count
    FROM pages GROUP BY domain ORDER BY count DESC LIMIT 8
  `,
    )
    .all();
  res.json({ pages, queued, terms, domains, topDomains });
});

// Serve React build in production
app.use(express.static(path.join(__dirname, "client/dist")));
app.get((req, res) => {
  res.sendFile(path.join(__dirname, "client/dist/index.html"));
});

app.listen(3000, () => {
  const pages = db.prepare("SELECT COUNT(*) AS c FROM pages").get().c;
  console.log(`🚀 Server at http://localhost:3000 | ${pages} pages indexed`);
});
