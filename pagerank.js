const { pool } = require("./db");

async function runPageRank(iterations = 20, damping = 0.85) {
  const { rows: pages } = await pool.query("SELECT id FROM pages");
  const N = pages.length;
  if (N === 0) return;

  const { rows: links } = await pool.query(`
    SELECT l.source_id, p.id AS target_id
    FROM links l
    JOIN pages p ON p.url = l.target_url
  `);

  const outbound = {};
  const inbound = {};
  for (const { id } of pages) {
    outbound[id] = [];
    inbound[id] = [];
  }

  for (const { source_id, target_id } of links) {
    if (outbound[source_id]) outbound[source_id].push(target_id);
    if (inbound[target_id]) inbound[target_id].push(source_id);
  }

  let pr = {};
  for (const { id } of pages) pr[id] = 1.0 / N;

  for (let iter = 0; iter < iterations; iter++) {
    const next = {};
    for (const { id } of pages) {
      const base = (1 - damping) / N;
      const incoming = inbound[id].reduce((sum, src) => {
        return sum + pr[src] / (outbound[src].length || 1);
      }, 0);
      next[id] = base + damping * incoming;
    }
    pr = next;
  }

  const maxPR = Math.max(...Object.values(pr)) || 1;

  // Batch update
  const cases = Object.entries(pr)
    .map(([id, score]) => `WHEN id = ${id} THEN ${(score / maxPR) * 10}`)
    .join(" ");
  const ids = Object.keys(pr).join(",");

  await pool.query(
    `UPDATE pages SET pagerank = CASE ${cases} END WHERE id IN (${ids})`,
  );
  console.log(`[PageRank] ✅ Updated ${N} pages`);
}

module.exports = { runPageRank };
