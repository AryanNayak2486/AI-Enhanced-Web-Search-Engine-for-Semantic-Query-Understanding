const express = require("express");
const path = require("path");
const { pool, init } = require("./db");
const { tokenize } = require("./indexer");

const app = express();
app.use(express.json());

function getSnippet(fullText, queryTokens, maxLen = 350) {
  if (!fullText) return "";
  const chunks = fullText.match(/[^.!?\n]{20,}[.!?\n]?/g) || [
    fullText.slice(0, maxLen),
  ];
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

async function search({ q, page = 1, pageSize = 10, domain, from, to }) {
  const tokens = tokenize(q);
  if (!tokens.length)
    return { results: [], total: 0, page, pageSize, tokens: [] };

  const { rows: countRow } = await pool.query(
    "SELECT COUNT(*) AS c FROM pages",
  );
  const totalDocs = parseInt(countRow[0].c) || 1;

  // Fetch TF-IDF data for query tokens
  const placeholders = tokens.map((_, i) => `$${i + 1}`).join(",");
  const { rows: termRows } = await pool.query(
    `SELECT t.term, t.doc_id, t.tf,
       (SELECT COUNT(DISTINCT doc_id) FROM terms WHERE term = t.term) AS df
     FROM terms t
     WHERE t.term IN (${placeholders})`,
    tokens,
  );

  const scores = {};
  for (const row of termRows) {
    const idf = Math.log((totalDocs + 1) / (parseInt(row.df) + 1)) + 1;
    scores[row.doc_id] = (scores[row.doc_id] || 0) + row.tf * idf;
  }

  if (!Object.keys(scores).length)
    return { results: [], total: 0, page, pageSize, tokens };

  const docIds = Object.keys(scores).map(Number);
  const idPlaceholders = docIds.map((_, i) => `$${i + 1}`).join(",");

  let filterSQL = "";
  const filterParams = [...docIds];
  let pi = docIds.length + 1;

  if (domain) {
    filterSQL += ` AND domain = $${pi++}`;
    filterParams.push(domain);
  }
  if (from) {
    filterSQL += ` AND crawled_at >= $${pi++}`;
    filterParams.push(from);
  }
  if (to) {
    filterSQL += ` AND crawled_at <= $${pi++}`;
    filterParams.push(to);
  }

  const { rows: pages } = await pool.query(
    `SELECT id, url, domain, title, snippet, full_text, crawled_at, pagerank
     FROM pages WHERE id IN (${idPlaceholders}) ${filterSQL}`,
    filterParams,
  );

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
    pagerank: parseFloat(r.pagerank).toFixed(2),
    score: r.finalScore.toFixed(4),
  }));

  return { results, total, page, pageSize, tokens, mode: "tfidf+pagerank" };
}

// ── Routes ───────────────────────────────────────────────────────────

app.get("/search", async (req, res) => {
  const { q, page = 1, pageSize = 10, domain, from, to } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: "Missing ?q=" });

  pool
    .query(
      `INSERT INTO queries (query, frequency, searched_at) VALUES ($1, 1, NOW())
     ON CONFLICT(query) DO UPDATE SET frequency = queries.frequency + 1, searched_at = NOW()`,
      [q.trim().toLowerCase()],
    )
    .catch(() => {});

  try {
    res.json(
      await search({ q, page: +page, pageSize: +pageSize, domain, from, to }),
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/autocomplete", async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ suggestions: [] });

  const prefix = q.toLowerCase();

  const { rows: fromQueries } = await pool.query(
    `SELECT query AS text, frequency AS score FROM queries WHERE query ILIKE $1 ORDER BY frequency DESC LIMIT 5`,
    [`${prefix}%`],
  );

  const { rows: fromTitles } = await pool.query(
    `SELECT title AS text, pagerank AS score FROM pages WHERE lower(title) ILIKE $1 ORDER BY pagerank DESC LIMIT 5`,
    [`%${prefix}%`],
  );

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

app.get("/stats", async (req, res) => {
  const {
    rows: [{ c: pages }],
  } = await pool.query("SELECT COUNT(*) AS c FROM pages");
  const {
    rows: [{ c: queued }],
  } = await pool.query(
    `SELECT COUNT(*) AS c FROM crawl_queue WHERE status = 'pending'`,
  );
  const {
    rows: [{ c: terms }],
  } = await pool.query("SELECT COUNT(DISTINCT term) AS c FROM terms");
  const {
    rows: [{ c: domains }],
  } = await pool.query("SELECT COUNT(DISTINCT domain) AS c FROM pages");
  const { rows: topDomains } = await pool.query(
    `SELECT domain, COUNT(*) AS count FROM pages GROUP BY domain ORDER BY count DESC LIMIT 8`,
  );
  res.json({
    pages: +pages,
    queued: +queued,
    terms: +terms,
    domains: +domains,
    topDomains,
  });
});

app.use(express.static(path.join(__dirname, "client/dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/dist/index.html"));
});

init()
  .then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () =>
      console.log(`🚀 Server at http://localhost:${PORT}`),
    );
  })
  .catch(console.error);
