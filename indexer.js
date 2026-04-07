const { pool } = require("./db");

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "it",
  "its",
  "was",
  "are",
  "be",
  "been",
  "has",
  "have",
  "had",
  "that",
  "this",
  "these",
  "those",
  "as",
  "not",
  "no",
  "so",
  "if",
  "we",
  "he",
  "she",
  "they",
  "you",
  "i",
  "my",
  "their",
  "our",
  "his",
  "her",
  "which",
  "who",
  "what",
  "when",
  "where",
  "will",
  "can",
  "do",
  "did",
  "does",
  "more",
  "also",
  "than",
  "then",
  "into",
  "over",
  "about",
  "up",
  "out",
  "after",
  "between",
  "each",
  "how",
  "all",
  "both",
  "through",
  "during",
  "before",
  "s",
  "t",
  "re",
  "would",
  "could",
  "should",
  "said",
  "just",
  "like",
  "get",
  "one",
  "two",
  "new",
  "may",
  "use",
  "used",
  "using",
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function computeTF(tokens) {
  const counts = {};
  for (const t of tokens) counts[t] = (counts[t] || 0) + 1;
  const total = tokens.length || 1;
  const tf = {};
  for (const [t, c] of Object.entries(counts)) tf[t] = c / total;
  return tf;
}

async function indexPage(docId, text) {
  const tokens = tokenize(text);
  const tf = computeTF(tokens);

  await pool.query("DELETE FROM terms WHERE doc_id = $1", [docId]);

  const entries = Object.entries(tf);
  if (!entries.length) return;

  // Batch insert
  const values = [];
  const params = [];
  let i = 1;
  for (const [term, score] of entries) {
    values.push(`($${i++}, $${i++}, $${i++})`);
    params.push(term, docId, score);
  }

  await pool.query(
    `INSERT INTO terms (term, doc_id, tf) VALUES ${values.join(",")} ON CONFLICT DO NOTHING`,
    params,
  );
}

module.exports = { indexPage, tokenize };
