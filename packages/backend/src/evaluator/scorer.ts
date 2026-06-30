import { z } from "zod";
import { getDb } from "../db/store.js";
import { loadRubricSet } from "./rubric.js";
import { callLlm } from "../agent/llm.js";
import { emitRunEvent } from "../agent/events.js";
import type { Rubric, FindingEvidence } from "../db/models.js";

const EvaluationResponseSchema = z.object({
  score: z.number(),
  maxScore: z.number(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  title: z.string(),
  description: z.string(),
  evidence: z.array(
    z.object({
      type: z.enum(["screenshot", "console", "network", "dom", "text"]),
      stepIndex: z.number().optional(),
      explanation: z.string(),
    })
  ),
});

const EVALUATOR_SYSTEM_PROMPT = `You are a rigorous product auditor evaluating a web app against a specific rubric.

You will receive:
- The rubric criterion (name, category, criteria, scoring type)
- A summary of the synthetic user session (URLs visited, actions taken, console logs, network errors)
- File paths to screenshots and DOM snapshots captured during the session

Respond with a single JSON object matching this schema:

{
  "score": number,
  "maxScore": number,
  "severity": "critical" | "high" | "medium" | "low" | "info",
  "title": "Short finding title",
  "description": "Detailed explanation with reasoning",
  "evidence": [
    {
      "type": "screenshot" | "console" | "network" | "dom" | "text",
      "stepIndex": 0,
      "explanation": "Why this evidence matters"
    }
  ]
}

Scoring rules:
- pass/fail: score 1 for pass, 0 for fail; maxScore 1
- present/absent: score 1 if present, 0 if absent; maxScore 1
- 1-5: score on a 1-5 scale; maxScore 5

Severity guidelines:
- critical: blocks a core user goal or causes data loss
- high: major friction, broken primary flow, or misleading content
- medium: noticeable UX or functional issue
- low: minor polish issue
- info: observation, not necessarily a problem

Be evidence-based. Reference specific step indices and artifact types. Do not make claims without citing evidence from the session.

Return ONLY raw, valid JSON. Do not include Markdown formatting, code blocks, or conversational text.`;

interface SessionStep {
  stepIndex: number;
  action: string;
  screenshotPath: string;
  domSnapshotPath: string;
  consoleLogs: string;
  networkErrors: string;
  url?: string;
  title?: string;
}

function maxScoreForRubric(rubric: Rubric): number {
  switch (rubric.scoringType) {
    case "pass/fail":
    case "present/absent":
      return 1;
    case "1-5":
      return 5;
    default:
      return 1;
  }
}

function buildSessionSummary(steps: SessionStep[]): string {
  return steps
    .map((step) => {
      const logs = JSON.parse(step.consoleLogs || "[]") as string[];
      const errors = JSON.parse(step.networkErrors || "[]") as string[];
      return `Step ${step.stepIndex}:
  Action: ${step.action}
  Screenshot: ${step.screenshotPath}
  DOM snapshot: ${step.domSnapshotPath}
  Console logs: ${logs.length > 0 ? logs.join("; ") : "none"}
  Network errors: ${errors.length > 0 ? errors.join("; ") : "none"}`;
    })
    .join("\n\n");
}

export async function scoreRun(runId: string, rubricSetId: string): Promise<void> {
  const db = getDb();
  const rubricSet = loadRubricSet(rubricSetId);
  const steps = db
    .prepare(
      `SELECT step_index as stepIndex, action, screenshot_path as screenshotPath,
              dom_snapshot_path as domSnapshotPath, console_logs as consoleLogs,
              network_errors as networkErrors
       FROM sessions WHERE run_id = ? ORDER BY step_index ASC`
    )
    .all(runId) as SessionStep[];

  if (steps.length === 0) {
    throw new Error("No session steps found for run");
  }

  if (process.env.MOCK_LLM === "true") {
    for (const rubric of rubricSet.rubrics) {
      const maxScore = maxScoreForRubric(rubric);
      const firstStep = steps[0];
      db.prepare(
        `INSERT INTO findings (id, run_id, rubric_id, category, title, description, severity, score, max_score, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        runId,
        rubric.id,
        rubric.category,
        `[Mock] ${rubric.name}`,
        `Mock evaluation for: ${rubric.criteria}`,
        "info",
        maxScore,
        maxScore,
        JSON.stringify([
          { type: "screenshot", path: firstStep.screenshotPath, content: "Mock evidence screenshot" },
        ]),
        new Date().toISOString()
      );
    }
    return;
  }

  const sessionSummary = buildSessionSummary(steps);

  for (const rubric of rubricSet.rubrics) {
    emitRunEvent(runId, {
      type: "rubric.start",
      rubricId: rubric.id,
      rubricName: rubric.name,
      timestamp: new Date().toISOString(),
    });

    const userPrompt = `Rubric:
${JSON.stringify(rubric, null, 2)}

Session summary:
${sessionSummary}`;

    try {
      const response = await callLlm({
        systemPrompt: EVALUATOR_SYSTEM_PROMPT,
        userPrompt,
        schema: EvaluationResponseSchema,
        temperature: 0.1,
        maxTokens: 2048,
        runId,
        stepIndex: -2,
      });

      const result = response.data;
      const maxScore = maxScoreForRubric(rubric);
      const clampedScore = Math.max(0, Math.min(result.score, maxScore));

      const evidence: FindingEvidence[] = result.evidence.map((e) => {
        const step = typeof e.stepIndex === "number" ? steps[e.stepIndex] : undefined;
        if (e.type === "screenshot" && step) {
          return { type: "screenshot", path: step.screenshotPath, content: e.explanation };
        }
        if (e.type === "dom" && step) {
          return { type: "dom", path: step.domSnapshotPath, content: e.explanation };
        }
        if (e.type === "console" && step) {
          return { type: "console", content: `${e.explanation}\n${step.consoleLogs}` };
        }
        if (e.type === "network" && step) {
          return { type: "network", content: `${e.explanation}\n${step.networkErrors}` };
        }
        return { type: "text", content: e.explanation };
      });

      db.prepare(
        `INSERT INTO findings (id, run_id, rubric_id, category, title, description, severity, score, max_score, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        runId,
        rubric.id,
        rubric.category,
        result.title,
        result.description,
        result.severity,
        clampedScore,
        maxScore,
        JSON.stringify(evidence),
        new Date().toISOString()
      );

      emitRunEvent(runId, {
        type: "rubric.score",
        rubricId: rubric.id,
        rubricName: rubric.name,
        category: rubric.category,
        score: clampedScore,
        maxScore,
        severity: result.severity,
        title: result.title,
        description: result.description,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const maxScore = maxScoreForRubric(rubric);
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Record an evaluation failure as an info finding so the run still completes.
      db.prepare(
        `INSERT INTO findings (id, run_id, rubric_id, category, title, description, severity, score, max_score, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        runId,
        rubric.id,
        rubric.category,
        `Evaluation failed for ${rubric.name}`,
        errorMessage,
        "info",
        0,
        maxScore,
        JSON.stringify([{ type: "text", content: "Evaluator could not score this rubric." }]),
        new Date().toISOString()
      );

      emitRunEvent(runId, {
        type: "rubric.score",
        rubricId: rubric.id,
        rubricName: rubric.name,
        category: rubric.category,
        score: 0,
        maxScore,
        severity: "info",
        title: `Evaluation failed for ${rubric.name}`,
        description: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
