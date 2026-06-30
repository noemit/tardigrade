// CLI script to run a single audit without the Electron UI.
// Useful for testing the backend pipeline directly.
//
// Usage:
//   MOCK_LLM=true npx tsx scripts/run-example.ts https://example.com
//   MOCK_LLM=true npx tsx scripts/run-example.ts http://localhost:8000/sample.html default

import { runAgentLoop } from "../src/agent/loop.js";
import { scoreRun } from "../src/evaluator/scorer.js";
import { getDb } from "../src/db/store.js";

async function main() {
  const url = process.argv[2];
  const rubricSetId = process.argv[3] || "default";

  if (!url) {
    console.error("Usage: npx tsx scripts/run-example.ts <url> [rubricSetId]");
    process.exit(1);
  }

  // Ensure DB is initialized.
  getDb();

  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO runs (id, url, status, rubric_set_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(runId, url, "running", rubricSetId, now, now);

  console.log(`Starting audit: ${runId}`);
  console.log(`URL: ${url}`);
  console.log(`Rubric set: ${rubricSetId}`);

  try {
    const result = await runAgentLoop({ runId, url, maxSteps: 8 });
    console.log(`Agent loop finished: ${result.finalStatus}`);
    console.log(`Summary: ${result.summary}`);

    await scoreRun(runId, rubricSetId);
    console.log("Scoring complete.");

    const completedAt = new Date().toISOString();
    db.prepare(
      `UPDATE runs
       SET status = ?, completed_at = ?, updated_at = ?, token_count = ?, llm_call_count = ?
       WHERE id = ?`
    ).run("completed", completedAt, completedAt, result.memory.totalTokens, result.memory.llmCallCount, runId);

    const findings = db
      .prepare(`SELECT category, title, severity, score, max_score FROM findings WHERE run_id = ?`)
      .all(runId);

    console.log("\nFindings:");
    for (const f of findings as any[]) {
      console.log(`- [${f.severity}] ${f.title} (${f.category}): ${f.score}/${f.max_score}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedAt = new Date().toISOString();
    db.prepare(`UPDATE runs SET status = ?, updated_at = ?, completed_at = ?, error = ? WHERE id = ?`).run(
      "failed",
      failedAt,
      failedAt,
      message,
      runId
    );
    console.error("Audit failed:", message);
    process.exit(1);
  }
}

main();
