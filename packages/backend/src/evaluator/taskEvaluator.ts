import { z } from "zod";
import { getDb } from "../db/store.js";
import { callLlm } from "../agent/llm.js";
import { emitRunEvent } from "../agent/events.js";
import type { FindingEvidence } from "../db/models.js";

const TaskEvaluationResponseSchema = z.object({
  summary: z.string(),
  completed: z.boolean(),
  findings: z.array(
    z.object({
      category: z.enum(["ux", "functional", "conversion", "accessibility", "custom", "task"]),
      title: z.string(),
      description: z.string(),
      severity: z.enum(["critical", "high", "medium", "low", "info"]),
      score: z.number(),
      maxScore: z.number(),
      evidence: z.array(
        z.object({
          type: z.enum(["screenshot", "text"]),
          frameIndex: z.number().optional(),
          explanation: z.string(),
        })
      ),
    })
  ),
});

const TASK_EVALUATOR_SYSTEM_PROMPT = `You are a rigorous product auditor evaluating whether a synthetic user accomplished an assigned task on a website.

You will receive:
- The URL that was audited
- The task / goal given to the agent
- A summary of the synthetic user session (frames captured, URLs visited, zooms, pans, clicks, and commentary)
- File paths to screenshots captured during the session

Respond with a single JSON object matching this schema:

{
  "summary": "A concise narrative of what the agent did and whether it completed the task",
  "completed": true | false,
  "findings": [
    {
      "category": "ux" | "functional" | "conversion" | "accessibility" | "custom" | "task",
      "title": "Short finding title",
      "description": "Detailed explanation with reasoning",
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "score": number,
      "maxScore": number,
      "evidence": [
        {
          "type": "screenshot" | "text",
          "frameIndex": 0,
          "explanation": "Why this evidence matters"
        }
      ]
    }
  ]
}

Scoring rules:
- Use score and maxScore to indicate how well the task was completed or how severe an issue is.
- For task completion, a high score means the agent clearly achieved the goal; a low score means it failed or was blocked.
- For issues, score reflects impact (e.g., 5/5 for a blocker, 1/5 for a minor observation).

Severity guidelines:
- critical: blocks a core user goal or causes data loss
- high: major friction, broken primary flow, or misleading content
- medium: noticeable UX or functional issue
- low: minor polish issue
- info: observation, not necessarily a problem

Be evidence-based. Reference specific frame indices and artifact types. Do not make claims without citing evidence from the session.

Return ONLY raw, valid JSON. Do not include Markdown formatting, code blocks, or conversational text.`;

interface FrameStep {
  frameIndex: number;
  url: string;
  title: string;
  screenshotPath: string;
  looks: {
    lookIndex: number;
    type: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    commentaryText?: string;
  }[];
}

function buildSessionSummary(frames: FrameStep[]): string {
  return frames
    .map((frame) => {
      const looks = frame.looks
        .map((look) => {
          const coords =
            look.x !== undefined && look.y !== undefined
              ? ` at (${look.x}, ${look.y})`
              : "";
          const size =
            look.width !== undefined && look.height !== undefined
              ? ` size ${look.width}x${look.height}`
              : "";
          const text = look.commentaryText ? `: "${look.commentaryText}"` : "";
          return `    Look ${look.lookIndex}: ${look.type}${coords}${size}${text}`;
        })
        .join("\n");
      return `Frame ${frame.frameIndex}:
  URL: ${frame.url}
  Title: ${frame.title}
  Screenshot: ${frame.screenshotPath}
${looks || "    (no looks)"}`;
    })
    .join("\n\n");
}

export async function evaluateRun(runId: string): Promise<{ summary: string; completed: boolean; cachedTokens: number }> {
  const db = getDb();

  const run = db
    .prepare(
      `SELECT id, url, goal FROM runs WHERE id = ?`
    )
    .get(runId) as { id: string; url: string; goal: string | null } | undefined;

  if (!run) {
    throw new Error("Run not found");
  }

  const goal = run.goal?.trim() || "Explore the site and describe what it is about and who it is for.";

  const frameRows = db
    .prepare(
      `SELECT id, frame_index as frameIndex, screenshot_path as screenshotPath, url, title
       FROM frames WHERE run_id = ? ORDER BY frame_index ASC`
    )
    .all(runId) as { id: string; frameIndex: number; screenshotPath: string; url: string; title: string }[];

  if (frameRows.length === 0) {
    throw new Error("No frames found for run");
  }

  const lookRows = db
    .prepare(
      `SELECT frame_id as frameId, look_index as lookIndex, type, x, y, width, height, commentary_text as commentaryText
       FROM looks WHERE run_id = ? ORDER BY look_index ASC`
    )
    .all(runId) as {
    frameId: string;
    lookIndex: number;
    type: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    commentaryText?: string;
  }[];

  const looksByFrame = new Map<string, typeof lookRows>();
  for (const look of lookRows) {
    const list = looksByFrame.get(look.frameId) ?? [];
    list.push(look);
    looksByFrame.set(look.frameId, list);
  }

  const frames: FrameStep[] = frameRows.map((frame) => ({
    frameIndex: frame.frameIndex,
    url: frame.url,
    title: frame.title,
    screenshotPath: frame.screenshotPath,
    looks: (looksByFrame.get(frame.id) ?? []).map((look) => ({
      lookIndex: look.lookIndex,
      type: look.type,
      x: look.x,
      y: look.y,
      width: look.width,
      height: look.height,
      commentaryText: look.commentaryText,
    })),
  }));

  const sessionSummary = buildSessionSummary(frames);

  if (process.env.MOCK_LLM === "true") {
    const firstFrame = frames[0];
    const summary = `Mock evaluation for task: ${goal}`;
    db.prepare(
      `INSERT INTO findings (id, run_id, rubric_id, category, title, description, severity, score, max_score, evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      runId,
      "task",
      "task",
      "[Mock] Task evaluation",
      summary,
      "info",
      1,
      1,
      JSON.stringify([
        { type: "screenshot", path: firstFrame.screenshotPath, content: "Mock evidence screenshot" },
      ]),
      new Date().toISOString()
    );
    db.prepare(`UPDATE runs SET evaluation_summary = ? WHERE id = ?`).run(summary, runId);
    return { summary, completed: true, cachedTokens: 0 };
  }

  const userPrompt = `URL: ${run.url}

Task / goal for the agent:
${goal}

Session summary:
${sessionSummary}`;

  try {
    const response = await callLlm({
      systemPrompt: TASK_EVALUATOR_SYSTEM_PROMPT,
      userPrompt,
      schema: TaskEvaluationResponseSchema,
      temperature: 0.1,
      maxTokens: 4096,
      cacheKey: runId,
      runId,
      stepIndex: -1,
    });

    const result = response.data;
    db.prepare(`UPDATE runs SET evaluation_summary = ? WHERE id = ?`).run(result.summary, runId);

    for (const finding of result.findings) {
      const findingId = crypto.randomUUID();

      emitRunEvent(runId, {
        type: "rubric.start",
        rubricId: findingId,
        rubricName: finding.title,
        timestamp: new Date().toISOString(),
      });
      const clampedScore = Math.max(0, Math.min(finding.score, finding.maxScore));
      const evidence: FindingEvidence[] = finding.evidence.map((e) => {
        const frame = typeof e.frameIndex === "number" ? frames[e.frameIndex] : undefined;
        if (e.type === "screenshot" && frame) {
          return { type: "screenshot", path: frame.screenshotPath, content: e.explanation };
        }
        return { type: "text", content: e.explanation };
      });

      db.prepare(
        `INSERT INTO findings (id, run_id, rubric_id, category, title, description, severity, score, max_score, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        runId,
        "task",
        finding.category,
        finding.title,
        finding.description,
        finding.severity,
        clampedScore,
        finding.maxScore,
        JSON.stringify(evidence),
        new Date().toISOString()
      );

      emitRunEvent(runId, {
        type: "rubric.score",
        rubricId: findingId,
        rubricName: finding.title,
        category: finding.category,
        score: clampedScore,
        maxScore: finding.maxScore,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        timestamp: new Date().toISOString(),
      });
    }

    return { summary: result.summary, completed: result.completed, cachedTokens: response.cachedTokens };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const summary = `Task evaluation failed: ${errorMessage}`;
    db.prepare(`UPDATE runs SET evaluation_summary = ? WHERE id = ?`).run(summary, runId);
    db.prepare(
      `INSERT INTO findings (id, run_id, rubric_id, category, title, description, severity, score, max_score, evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      runId,
      "task",
      "task",
      "Task evaluation failed",
      errorMessage,
      "info",
      0,
      1,
      JSON.stringify([{ type: "text", content: "Evaluator could not score this task." }]),
      new Date().toISOString()
    );

    emitRunEvent(runId, {
      type: "rubric.score",
      rubricId: "task",
      rubricName: "Task evaluation",
      category: "task",
      score: 0,
      maxScore: 1,
      severity: "info",
      title: "Task evaluation failed",
      description: errorMessage,
      timestamp: new Date().toISOString(),
    });

    return { summary, completed: false, cachedTokens: 0 };
  }
}
