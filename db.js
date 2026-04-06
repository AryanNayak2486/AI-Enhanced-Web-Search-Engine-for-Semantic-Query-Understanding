const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "search.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("cache_size = -32000");

db.exec(`
  CREATE TABLE IF NOT EXISTS pages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url         TEXT    UNIQUE NOT NULL,
    domain      TEXT    NOT NULL DEFAULT '',
    title       TEXT    NOT NULL DEFAULT '',
    snippet     TEXT    NOT NULL DEFAULT '',
    full_text   TEXT    NOT NULL DEFAULT '',
    word_count  INTEGER NOT NULL DEFAULT 0,
    crawled_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    next_crawl  TEXT    NOT NULL DEFAULT (datetime('now', '+24 hours')),
    pagerank    REAL    NOT NULL DEFAULT 1.0
  );

  CREATE TABLE IF NOT EXISTS links (
    source_id  INTEGER NOT NULL,
    target_url TEXT    NOT NULL,
    PRIMARY KEY (source_id, target_url),
    FOREIGN KEY (source_id) REFERENCES pages(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS crawl_queue (
    url          TEXT    PRIMARY KEY,
    priority     REAL    NOT NULL DEFAULT 0.5,
    status       TEXT    NOT NULL DEFAULT 'pending',
    added_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    attempts     INTEGER NOT NULL DEFAULT 0,
    next_attempt TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS terms (
    term   TEXT    NOT NULL,
    doc_id INTEGER NOT NULL,
    tf     REAL    NOT NULL,
    PRIMARY KEY (term, doc_id),
    FOREIGN KEY (doc_id) REFERENCES pages(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS queries (
    query       TEXT    PRIMARY KEY,
    frequency   INTEGER NOT NULL DEFAULT 1,
    searched_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_pages_domain     ON pages(domain);
  CREATE INDEX IF NOT EXISTS idx_pages_crawled_at ON pages(crawled_at);
  CREATE INDEX IF NOT EXISTS idx_pages_pagerank   ON pages(pagerank DESC);
  CREATE INDEX IF NOT EXISTS idx_terms_term       ON terms(term);
  CREATE INDEX IF NOT EXISTS idx_queue_pending    ON crawl_queue(status, priority DESC, next_attempt);
`);

module.exports = db;
