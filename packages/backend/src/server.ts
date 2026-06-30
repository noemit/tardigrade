import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import { config, getUserSettings, saveUserSettings, reloadConfig } from "./config.js";
import { getDb } from "./db/store.js";
import {
  checkPlaywrightAvailability,
  SupportedBrowser,
} from "./browser/playwright-manager.js";
import { runAgentLoop } from "./agent/loop.js";
import { evaluateRun } from "./evaluator/taskEvaluator.js";
import { getRunEmitter } from "./agent/events.js";
import type { Viewport } from "./db/models.js";
import {
  listRubricSets,
  generateRubricSetFromPrompt,
  validateRubricSet,
  saveRubricSet,
  loadRubricSet,
} from "./evaluator/rubric.js";

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }

  return `https://${trimmed}`;
}

function toArtifactUrl(filePath: string): string {
  const artifactsDir = path.join(config.userDataDir, "artifacts");
  if (filePath.startsWith(artifactsDir)) {
    return "/artifacts" + filePath.slice(artifactsDir.length).replace(/\\/g, "/");
  }
  return filePath;
}

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use("/artifacts", express.static(path.join(config.userDataDir, "artifacts")));

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Playwright availability check
  app.get("/playwright-status", async (_req: Request, res: Response) => {
    const status = await checkPlaywrightAvailability();
    res.json(status);
  });

  // List runs
  app.get("/runs", (_req: Request, res: Response) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, url, status, rubric_set_id as rubricSetId, goal,
                browser, viewport, max_duration_seconds as maxDurationSeconds, batch_id as batchId,
                created_at as createdAt, updated_at as updatedAt,
                completed_at as completedAt, error,
                token_count as tokenCount, llm_call_count as llmCallCount,
                cached_token_count as cachedTokens, evaluation_summary as evaluationSummary
         FROM runs ORDER BY created_at DESC`
      )
      .all();
    const runs = (rows as any[]).map((r) => ({
      ...r,
      viewport: r.viewport ? JSON.parse(r.viewport) : undefined,
    }));
    res.json({ runs });
  });

  // Get a single run
  app.get("/runs/:id", (req: Request, res: Response) => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, url, status, rubric_set_id as rubricSetId, goal,
                browser, viewport, max_duration_seconds as maxDurationSeconds, batch_id as batchId,
                created_at as createdAt, updated_at as updatedAt,
                completed_at as completedAt, error,
                token_count as tokenCount, llm_call_count as llmCallCount,
                cached_token_count as cachedTokens, evaluation_summary as evaluationSummary
         FROM runs WHERE id = ?`
      )
      .get(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    const run = {
      ...row,
      viewport: (row as any).viewport ? JSON.parse((row as any).viewport) : undefined,
    };
    res.json({ run });
  });

  // Stream run events (screenshots, actions, thoughts, rubric scores)
  app.get("/runs/:id/stream", (req: Request, res: Response) => {
    const runId = req.params.id;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const emitter = getRunEmitter(runId);

    function send(event: unknown) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    send({ type: "connected", runId, timestamp: new Date().toISOString() });

    const listener = (event: unknown) => {
      send(event);
      const e = event as { type: string };
      if (e.type === "run.completed" || e.type === "run.failed") {
        // Give clients a moment to process the final event before closing.
        setTimeout(() => res.end(), 500);
      }
    };

    emitter.on("event", listener);

    req.on("close", () => {
      emitter.off("event", listener);
    });
  });

  async function executeSingleRun(options: {
    runId: string;
    url: string;
    goal?: string;
    browser: SupportedBrowser;
    viewport: Viewport;
    maxDurationSeconds?: number;
    batchId?: string;
  }): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO runs (id, url, status, goal, browser, viewport, max_duration_seconds, batch_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      options.runId,
      options.url,
      "running",
      options.goal ?? null,
      options.browser,
      JSON.stringify(options.viewport),
      options.maxDurationSeconds ?? null,
      options.batchId ?? null,
      now,
      now
    );

    try {
      const result = await runAgentLoop({
        runId: options.runId,
        url: options.url,
        goal: options.goal,
        maxSteps: 30,
        browser: options.browser,
        viewport: options.viewport,
        maxDurationSeconds: options.maxDurationSeconds,
      });
      const evaluation = await evaluateRun(options.runId);
      const completedAt = new Date().toISOString();

      db.prepare(
        `UPDATE runs
         SET status = ?, completed_at = ?, updated_at = ?, token_count = ?, llm_call_count = ?, cached_token_count = ?, error = ?, evaluation_summary = ?
         WHERE id = ?`
      ).run(
        "completed",
        completedAt,
        completedAt,
        result.memory.totalTokens,
        result.memory.llmCallCount,
        result.memory.cachedTokens + evaluation.cachedTokens,
        null,
        evaluation.summary,
        options.runId
      );
    } catch (err) {
      const failedAt = new Date().toISOString();
      const errorMessage = err instanceof Error ? err.message : String(err);
      db.prepare(
        `UPDATE runs SET status = ?, updated_at = ?, completed_at = ?, error = ? WHERE id = ?`
      ).run("failed", failedAt, failedAt, errorMessage, options.runId);

      // Re-throw so the batch endpoint can record the failure but continue with other combos.
      throw err;
    }
  }

  // Create one or more runs (one per browser/viewport combination)
  app.post("/runs", async (req: Request, res: Response) => {
    const {
      url,
      goal,
      browsers,
      viewports,
      maxDurationSeconds,
    } = req.body;

    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "url is required" });
      return;
    }

    const normalizedUrl = normalizeUrl(url);

    const selectedBrowsers: SupportedBrowser[] = Array.isArray(browsers) && browsers.length > 0
      ? browsers
      : ["chromium"];
    const selectedViewports: Viewport[] = Array.isArray(viewports) && viewports.length > 0
      ? viewports
      : [{ width: 1280, height: 800 }];

    const batchId = crypto.randomUUID();
    const runSpecs = selectedBrowsers.flatMap((browser) =>
      selectedViewports.map((viewport) => ({
        runId: crypto.randomUUID(),
        browser,
        viewport,
      }))
    );

    // Start all runs in the background; respond immediately with the run IDs.
    const runPromises = runSpecs.map(({ runId, browser, viewport }) =>
      executeSingleRun({
        runId,
        url: normalizedUrl,
        goal,
        browser,
        viewport,
        maxDurationSeconds: typeof maxDurationSeconds === "number" ? maxDurationSeconds : undefined,
        batchId,
      }).catch((err) => {
        console.error(`Run ${runId} failed:`, err);
      })
    );

    // Fetch the created run rows to return.
    const db = getDb();
    const placeholders = runSpecs.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT id, url, status, rubric_set_id as rubricSetId, goal,
                browser, viewport, max_duration_seconds as maxDurationSeconds, batch_id as batchId,
                created_at as createdAt, updated_at as updatedAt,
                completed_at as completedAt, error,
                token_count as tokenCount, llm_call_count as llmCallCount,
                cached_token_count as cachedTokens, evaluation_summary as evaluationSummary
         FROM runs WHERE id IN (${placeholders})`
      )
      .all(...runSpecs.map((s) => s.runId));

    const runs = (rows as any[]).map((r) => ({
      ...r,
      viewport: r.viewport ? JSON.parse(r.viewport) : undefined,
    }));

    res.status(202).json({ runs, batchId });

    // Continue executing after the response has been sent.
    Promise.all(runPromises).then(() => {
      console.log(`Batch ${batchId} completed`);
    });
  });

  // Get sessions for a run
  app.get("/runs/:id/sessions", (req: Request, res: Response) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, run_id as runId, step_index as stepIndex, action,
                screenshot_path as screenshotPath, dom_snapshot_path as domSnapshotPath,
                console_logs as consoleLogs, network_errors as networkErrors,
                created_at as createdAt
         FROM sessions WHERE run_id = ? ORDER BY step_index ASC`
      )
      .all(req.params.id);
    const sessions = (rows as any[]).map((s) => ({
      ...s,
      screenshotUrl: s.screenshotPath ? toArtifactUrl(s.screenshotPath) : null,
      domSnapshotUrl: s.domSnapshotPath ? toArtifactUrl(s.domSnapshotPath) : null,
    }));
    res.json({ sessions });
  });

  // Get findings for a run
  app.get("/runs/:id/findings", (req: Request, res: Response) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, run_id as runId, rubric_id as rubricId, category, title,
                description, severity, score, max_score as maxScore,
                evidence, created_at as createdAt
         FROM findings WHERE run_id = ? ORDER BY created_at DESC`
      )
      .all(req.params.id);
    const findings = (rows as any[]).map((f) => {
      const evidence = JSON.parse(f.evidence).map((e: any) => ({
        ...e,
        url: e.path ? toArtifactUrl(e.path) : undefined,
      }));
      return { ...f, evidence };
    });
    res.json({ findings });
  });

  // Get timeline screenshots for a run
  app.get("/runs/:id/timeline", (req: Request, res: Response) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, run_id as runId, screenshot_path as screenshotPath,
                captured_at as capturedAt
         FROM timeline_captures WHERE run_id = ? ORDER BY captured_at ASC`
      )
      .all(req.params.id);
    const timeline = (rows as any[]).map((t) => ({
      ...t,
      screenshotUrl: t.screenshotPath ? toArtifactUrl(t.screenshotPath) : null,
    }));
    res.json({ timeline });
  });

  // Get frames for a run
  app.get("/runs/:id/frames", (req: Request, res: Response) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, run_id as runId, frame_index as frameIndex, screenshot_path as screenshotPath,
                url, title, created_at as createdAt
         FROM frames WHERE run_id = ? ORDER BY frame_index ASC`
      )
      .all(req.params.id);
    const frames = (rows as any[]).map((f) => ({
      ...f,
      screenshotUrl: f.screenshotPath ? toArtifactUrl(f.screenshotPath) : null,
    }));
    res.json({ frames });
  });

  // Get looks for a run
  app.get("/runs/:id/looks", (req: Request, res: Response) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, frame_id as frameId, run_id as runId, frame_index as frameIndex, look_index as lookIndex, type,
                screenshot_path as screenshotPath, x, y, width, height,
                commentary_text as commentaryText, action, created_at as createdAt
         FROM looks WHERE run_id = ? ORDER BY created_at ASC`
      )
      .all(req.params.id);
    const looks = (rows as any[]).map((l) => ({
      ...l,
      screenshotUrl: l.screenshotPath ? toArtifactUrl(l.screenshotPath) : null,
    }));
    res.json({ looks });
  });

  // Get LLM reasoning/thoughts for a run
  app.get("/runs/:id/thoughts", (req: Request, res: Response) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, run_id as runId, step_index as stepIndex, text, created_at as createdAt
         FROM thoughts WHERE run_id = ? ORDER BY step_index ASC`
      )
      .all(req.params.id);
    res.json({ thoughts: rows });
  });

  // Get debug log (LLM requests/responses/errors) for a run
  app.get("/runs/:id/debug-log", (req: Request, res: Response) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, run_id as runId, step_index as stepIndex, type, content, created_at as createdAt
         FROM debug_log WHERE run_id = ? ORDER BY created_at ASC`
      )
      .all(req.params.id);
    res.json({ entries: rows });
  });

  // List rubric sets
  app.get("/rubrics", (_req: Request, res: Response) => {
    try {
      const sets = listRubricSets();
      res.json({ sets });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // Get a single rubric set
  app.get("/rubrics/:id", (req: Request, res: Response) => {
    try {
      const rubricSet = loadRubricSet(req.params.id);
      res.json({ rubricSet });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // Save a custom rubric set
  app.post("/rubrics", (req: Request, res: Response) => {
    try {
      const rubricSet = validateRubricSet(req.body);
      saveRubricSet(rubricSet);
      res.status(201).json({ rubricSet });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // Generate a rubric set from a plain-English prompt
  app.post("/rubrics/generate", async (req: Request, res: Response) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    try {
      const rubricSet = await generateRubricSetFromPrompt(prompt);
      res.json({ rubricSet });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // Validate a user-uploaded rubric set
  app.post("/rubrics/validate", (req: Request, res: Response) => {
    try {
      const rubricSet = validateRubricSet(req.body);
      res.json({ valid: true, rubricSet });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ valid: false, error: message });
    }
  });

  // Get user settings
  app.get("/settings", (_req: Request, res: Response) => {
    const settings = getUserSettings();

    const savedApiKey = settings.llmApiKey || settings.cerebrasApiKey || "";
    const envApiKey = process.env.LLM_API_KEY || process.env.CEREBRAS_API_KEY || "";
    const effectiveApiKey = savedApiKey || envApiKey;

    const envModel = process.env.LLM_MODEL || process.env.CEREBRAS_MODEL || "";
    const savedModel = settings.llmModel || settings.cerebrasModel || "";
    const effectiveModel = savedModel || envModel || config.defaults.model;

    const envBaseUrl = process.env.LLM_BASE_URL || process.env.CEREBRAS_BASE_URL || "";
    const savedBaseUrl = settings.llmBaseUrl || "";

    res.json({
      settings: {
        llmProvider: settings.llmProvider || process.env.LLM_PROVIDER || "custom",
        llmApiKey: effectiveApiKey ? "***" : "",
        llmApiKeySource: savedApiKey ? "saved" : envApiKey ? "env" : "unset",
        llmBaseUrl: config.llm.baseUrl,
        llmBaseUrlSource: savedBaseUrl ? "saved" : envBaseUrl ? "env" : "default",
        llmModel: effectiveModel,
        llmModelSource: savedModel ? "saved" : envModel ? "env" : "default",
        imageMode: config.vision.imageMode,
        defaultBrowser: settings.defaultBrowser || "chromium",
      },
    });
  });

  // Update user settings
  app.post("/settings", (req: Request, res: Response) => {
    const { llmProvider, llmApiKey, llmBaseUrl, llmModel, imageMode, defaultBrowser } = req.body;
    const current = getUserSettings();

    const next: typeof current = {
      ...current,
      llmProvider: llmProvider ?? current.llmProvider,
      llmModel: llmModel || current.llmModel || undefined,
      llmBaseUrl: llmBaseUrl || current.llmBaseUrl || undefined,
      imageMode: imageMode || current.imageMode || undefined,
      defaultBrowser: defaultBrowser || current.defaultBrowser || "chromium",
    };

    // Only update the API key if a new value is provided (allow clearing with empty string).
    if (typeof llmApiKey === "string") {
      next.llmApiKey = llmApiKey;
    }

    saveUserSettings(next);
    reloadConfig();

    res.json({
      settings: {
        llmProvider: next.llmProvider || "custom",
        llmApiKey: next.llmApiKey ? "***" : "",
        llmBaseUrl: config.llm.baseUrl,
        llmModel: next.llmModel || config.llm.model,
        imageMode: config.vision.imageMode,
        defaultBrowser: next.defaultBrowser,
      },
    });
  });

  return app;
}

export function startServer() {
  const app = createServer();
  const server = app.listen(config.port, () => {
    console.log(`Tardigrade backend listening on http://localhost:${config.port}`);
  });
  return server;
}
