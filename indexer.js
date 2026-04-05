const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const INDEX_FILE = path.join(__dirname, "index.json");

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
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function computeTF(tokens) {
  const tf = {};
  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }
  for (const token in tf) {
    tf[token] = tf[token] / tokens.length;
  }
  return tf;
}

function buildIndex() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  console.log(`\nIndexing ${files.length} documents...\n`);

  const documents = [];
  const dfMap = new Map(); // FIX: use Map to avoid prototype collisions

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));

    if (!raw.text || raw.text.length < 100) {
      console.log(`[Skipped] ${raw.title || file} — too short`);
      continue;
    }

    const tokens = tokenize(raw.text);
    const tf = computeTF(tokens);

    documents.push({
      id: documents.length,
      url: raw.url,
      title: raw.title,
      snippet: raw.text.slice(0, 200),
      tf,
    });

    for (const term of Object.keys(tf)) {
      dfMap.set(term, (dfMap.get(term) || 0) + 1);
    }

    console.log(`[Indexed] "${raw.title}" — ${tokens.length} tokens`);
  }

  const N = documents.length;
  const invertedIndex = new Map(); // FIX: use Map here too

  for (const doc of documents) {
    for (const [term, tf] of Object.entries(doc.tf)) {
      const idf = Math.log(N / (dfMap.get(term) || 1));
      const tfidf = tf * idf;

      if (!invertedIndex.has(term)) invertedIndex.set(term, []);
      invertedIndex.get(term).push({ docId: doc.id, tfidf });
    }
  }

  // Sort each postings list by score
  for (const [, postings] of invertedIndex) {
    postings.sort((a, b) => b.tfidf - a.tfidf);
  }

  // Convert Map to plain object for JSON serialization
  const invertedIndexObj = {};
  for (const [term, postings] of invertedIndex) {
    invertedIndexObj[term] = postings;
  }

  const index = {
    documents: documents.map((d) => ({
      id: d.id,
      url: d.url,
      title: d.title,
      snippet: d.snippet,
    })),
    invertedIndex: invertedIndexObj,
    totalDocs: N,
    builtAt: new Date().toISOString(),
  };

  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  console.log(
    `\n✅ Done! Indexed ${N} docs, ${invertedIndex.size} unique terms`,
  );
  console.log(`Index saved to index.json`);
}

buildIndex();
