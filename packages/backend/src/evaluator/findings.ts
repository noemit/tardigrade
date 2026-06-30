import { getDb } from "../db/store.js";
import type { Finding } from "../db/models.js";

export interface FindingRow {
  id: string;
  run_id: string;
  rubric_id: string;
  category: string;
  title: string;
  description: string;
  severity: string;
  score: number;
  max_score: number;
  evidence: string;
  created_at: string;
}

export function listFindingsForRun(runId: string): Finding[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, run_id, rubric_id, category, title, description, severity,
              score, max_score, evidence, created_at
       FROM findings WHERE run_id = ? ORDER BY created_at DESC`
    )
    .all(runId) as FindingRow[];

  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    rubricId: row.rubric_id,
    category: row.category,
    title: row.title,
    description: row.description,
    severity: row.severity as Finding["severity"],
    score: row.score,
    maxScore: row.max_score,
    evidence: JSON.parse(row.evidence),
    createdAt: row.created_at,
  }));
}
