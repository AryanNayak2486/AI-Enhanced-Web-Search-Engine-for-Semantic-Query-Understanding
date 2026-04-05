const { pipeline } = require("@xenova/transformers");
const fs = require("fs");
const path = require("path");

const INDEX_FILE = path.join(__dirname, "index.json");
const EMBEDDINGS_FILE = path.join(__dirname, "embeddings.json");

async function generateEmbeddings() {
  console.log("\nLoading embedding model (downloads ~90MB on first run)...");
  const extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
  );
  console.log("✅ Model loaded!\n");

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
  const docs = index.documents;

  console.log(`Generating embeddings for ${docs.length} documents...\n`);

  const embeddings = {};

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];

    // Use title + snippet as the text to embed (short, focused)
    const text = `${doc.title}. ${doc.snippet}`.slice(0, 512);

    const output = await extractor(text, { pooling: "mean", normalize: true });
    embeddings[doc.id] = Array.from(output.data);

    console.log(`[${i + 1}/${docs.length}] "${doc.title}"`);
  }

  fs.writeFileSync(EMBEDDINGS_FILE, JSON.stringify(embeddings, null, 2));
  console.log(`\n✅ Done! Embeddings saved to embeddings.json`);
  console.log(`Each vector has ${embeddings[0].length} dimensions`);
}

generateEmbeddings();
