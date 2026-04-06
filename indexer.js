const db = require("./db");

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

const deleteTerms = db.prepare("DELETE FROM terms WHERE doc_id = ?");
const insertTerm = db.prepare(
  "INSERT OR REPLACE INTO terms (term, doc_id, tf) VALUES (?, ?, ?)",
);
const indexMany = db.transaction((docId, entries) => {
  deleteTerms.run(docId);
  for (const [term, tf] of entries) insertTerm.run(term, docId, tf);
});

function indexPage(docId, text) {
  const tokens = tokenize(text);
  const tf = computeTF(tokens);
  indexMany(docId, Object.entries(tf));
}

module.exports = { indexPage, tokenize };
