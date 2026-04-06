const db = require("./db");

function runPageRank(iterations = 25, damping = 0.85) {
  const pages = db.prepare("SELECT id FROM pages").all();
  const N = pages.length;
  if (N === 0) return;

  // Resolve links to (source_id → target_id) for pages we've indexed
  const links = db
    .prepare(
      `
    SELECT l.source_id, p.id AS target_id
    FROM links l
    JOIN pages p ON p.url = l.target_url
  `,
    )
    .all();

  // Build outbound + inbound maps
  const outbound = {};
  const inbound = {};
  for (const { id } of pages) {
    outbound[id] = [];
    inbound[id] = [];
  }

  for (const { source_id, target_id } of links) {
    if (outbound[source_id] !== undefined) outbound[source_id].push(target_id);
    if (inbound[target_id] !== undefined) inbound[target_id].push(source_id);
  }

  // Initialize PR uniformly
  let pr = {};
  for (const { id } of pages) pr[id] = 1.0 / N;

  // Iterate
  for (let i = 0; i < iterations; i++) {
    const next = {};
    for (const { id } of pages) {
      const base = (1 - damping) / N;
      const incoming = inbound[id].reduce((sum, src) => {
        const outCount = outbound[src].length || 1;
        return sum + pr[src] / outCount;
      }, 0);
      next[id] = base + damping * incoming;
    }
    pr = next;
  }

  // Normalize to 0–10 scale
  const maxPR = Math.max(...Object.values(pr)) || 1;
  const update = db.prepare("UPDATE pages SET pagerank = ? WHERE id = ?");
  const updateAll = db.transaction(() => {
    for (const [id, score] of Object.entries(pr)) {
      update.run((score / maxPR) * 10, parseInt(id));
    }
  });
  updateAll();

  console.log(`[PageRank] ✅ Updated ${N} pages (${iterations} iterations)`);
}

module.exports = { runPageRank };
