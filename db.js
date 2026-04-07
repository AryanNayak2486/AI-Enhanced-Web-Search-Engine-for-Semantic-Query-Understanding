const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com")
    ? { rejectUnauthorized: false }
    : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id          SERIAL PRIMARY KEY,
      url         TEXT    UNIQUE NOT NULL,
      domain      TEXT    NOT NULL DEFAULT '',
      title       TEXT    NOT NULL DEFAULT '',
      snippet     TEXT    NOT NULL DEFAULT '',
      full_text   TEXT    NOT NULL DEFAULT '',
      word_count  INTEGER NOT NULL DEFAULT 0,
      crawled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      next_crawl  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
      pagerank    REAL    NOT NULL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS links (
      source_id  INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      target_url TEXT    NOT NULL,
      PRIMARY KEY (source_id, target_url)
    );

    CREATE TABLE IF NOT EXISTS crawl_queue (
      url          TEXT    PRIMARY KEY,
      priority     REAL    NOT NULL DEFAULT 0.5,
      status       TEXT    NOT NULL DEFAULT 'pending',
      added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      attempts     INTEGER NOT NULL DEFAULT 0,
      next_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS terms (
      term   TEXT    NOT NULL,
      doc_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      tf     REAL    NOT NULL,
      PRIMARY KEY (term, doc_id)
    );

    CREATE TABLE IF NOT EXISTS queries (
      query       TEXT    PRIMARY KEY,
      frequency   INTEGER NOT NULL DEFAULT 1,
      searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_pages_domain     ON pages(domain);
    CREATE INDEX IF NOT EXISTS idx_pages_crawled_at ON pages(crawled_at);
    CREATE INDEX IF NOT EXISTS idx_pages_pagerank   ON pages(pagerank DESC);
    CREATE INDEX IF NOT EXISTS idx_terms_term       ON terms(term);
    CREATE INDEX IF NOT EXISTS idx_queue_pending    ON crawl_queue(status, priority DESC, next_attempt);
  `);
  console.log("✅ Database ready");
}

module.exports = { pool, init };
