const express = require("express");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("@xenova/transformers");

const app = express();
app.use(express.json());

const INDEX_FILE = path.join(__dirname, "index.json");
const EMBEDDINGS_FILE = path.join(__dirname, "embeddings.json");

// ── Load index + embeddings ──────────────────────────────────────────
let index = null;
let embeddings = null;
let extractor = null;

async function init() {
  // Load keyword index
  index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
  console.log(`✅ Index loaded — ${index.totalDocs} docs`);

  // Load embeddings if they exist
  if (fs.existsSync(EMBEDDINGS_FILE)) {
    embeddings = JSON.parse(fs.readFileSync(EMBEDDINGS_FILE, "utf-8"));
    console.log(
      `✅ Embeddings loaded — ${Object.keys(embeddings).length} vectors`,
    );

    // Load model for query embedding at search time
    console.log("Loading embedding model...");
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.log("✅ Model ready! Hybrid search enabled.\n");
  } else {
    console.warn("⚠️  No embeddings.json found — using keyword-only search");
    console.warn("    Run: node embedder.js to enable semantic search\n");
  }
}

// ── Stopwords + Tokenizer ────────────────────────────────────────────
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

// ── Cosine Similarity ────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// ── Normalize scores to 0-1 range ────────────────────────────────────
function normalize(scores) {
  const vals = Object.values(scores);
  const max = Math.max(...vals) || 1;
  const result = {};
  for (const [id, score] of Object.entries(scores)) {
    result[id] = score / max;
  }
  return result;
}

// ── Search ───────────────────────────────────────────────────────────
async function search(query) {
  if (!index) return { error: "Index not loaded" };

  // Step 1 — TF-IDF keyword scores
  const queryTokens = tokenize(query);
  const tfidfRaw = {};

  for (const term of queryTokens) {
    const postings = index.invertedIndex[term] || [];
    for (const { docId, tfidf } of postings) {
      tfidfRaw[docId] = (tfidfRaw[docId] || 0) + tfidf;
    }
  }

  const tfidfScores = normalize(tfidfRaw);

  // Step 2 — Semantic embedding scores (if available)
  let semanticScores = {};
  let mode = "keyword";

  if (extractor && embeddings) {
    const output = await extractor(query, { pooling: "mean", normalize: true });
    const queryVec = Array.from(output.data);

    for (const [docId, docVec] of Object.entries(embeddings)) {
      semanticScores[docId] = cosineSimilarity(queryVec, docVec);
    }
    semanticScores = normalize(semanticScores);
    mode = "hybrid";
  }

  // Step 3 — Hybrid blend: 40% TF-IDF + 60% semantic
  const allDocIds = new Set([
    ...Object.keys(tfidfScores),
    ...Object.keys(semanticScores),
  ]);

  const finalScores = {};
  for (const docId of allDocIds) {
    const tfidf = tfidfScores[docId] || 0;
    const semantic = semanticScores[docId] || 0;
    finalScores[docId] = 0.4 * tfidf + 0.6 * semantic;
  }

  // Step 4 — Sort and return top 10
  const results = Object.entries(finalScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([docId, score]) => ({
      ...index.documents[docId],
      score: score.toFixed(4),
      mode,
    }));

  return { query, tokens: queryTokens, mode, results };
}

// ── Routes ───────────────────────────────────────────────────────────
app.get("/search", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "Missing ?q= parameter" });
  res.json(await search(q));
});

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>AI Search Engine</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 700px; margin: 60px auto; padding: 0 20px; }
        h1 { color: #1a73e8; }
        input { width: 80%; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 4px; }
        button { padding: 10px 20px; font-size: 16px; background: #1a73e8; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 8px; }
        .result { margin: 20px 0; border-bottom: 1px solid #eee; padding-bottom: 16px; }
        .result a { color: #1a73e8; font-size: 18px; text-decoration: none; }
        .result a:hover { text-decoration: underline; }
        .score { color: #888; font-size: 12px; }
        .snippet { color: #444; font-size: 14px; margin-top: 4px; }
        .url { color: green; font-size: 13px; }
        .mode { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; background: #e8f0fe; color: #1a73e8; margin-bottom: 10px; }
        #status { color: #888; margin: 10px 0; }
      </style>
    </head>
    <body>
      <h1>🔍 AI Search Engine</h1>
      <div>
        <input id="q" type="text" placeholder="Search..." onkeydown="if(event.key==='Enter') doSearch()" />
        <button onclick="doSearch()">Search</button>
      </div>
      <div id="status"></div>
      <div id="results"></div>
      <script>
        async function doSearch() {
          const q = document.getElementById('q').value.trim();
          if (!q) return;
          document.getElementById('status').innerText = 'Searching...';
          document.getElementById('results').innerHTML = '';
          const res = await fetch('/search?q=' + encodeURIComponent(q));
          const data = await res.json();
          document.getElementById('status').innerHTML =
            data.results.length + ' results for "' + data.query + '" ' +
            '<span class="mode">' + data.mode + '</span>';
          if (data.results.length === 0) {
            document.getElementById('results').innerHTML = '<p>No results found.</p>';
            return;
          }
          document.getElementById('results').innerHTML = data.results.map(r => \`
            <div class="result">
              <a href="\${r.url}" target="_blank">\${r.title}</a>
              <div class="url">\${r.url}</div>
              <div class="snippet">\${r.snippet}...</div>
              <div class="score">Score: \${r.score}</div>
            </div>
          \`).join('');
        }
      </script>
    </body>
    </html>
  `);
});

init().then(() => {
  app.listen(3000, () => console.log("🚀 Server at http://localhost:3000"));
});
