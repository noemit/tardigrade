import { BrowserContext, Page, Locator } from "playwright";
import {
  createBrowserContext,
  SupportedBrowser,
} from "../browser/playwright-manager.js";
import { captureFrame, buildSemanticSnapshot } from "./perception.js";
import { callLlm } from "./llm.js";
import { ActionSchema, AgentAction } from "./actions.js";
import {
  createMemory,
  addLook,
  addTokens,
  addCachedTokens,
  SessionMemory,
  formatHistory,
} from "./memory.js";
import { getDb } from "../db/store.js";
import type { Frame, Look, Viewport } from "../db/models.js";
import { emitRunEvent, removeRunEmitter } from "./events.js";
import { config } from "../config.js";
import path from "path";

export interface AgentLoopOptions {
  runId: string;
  url: string;
  goal?: string;
  maxSteps?: number;
  browser?: SupportedBrowser;
  viewport?: Viewport;
  maxDurationSeconds?: number;
}

export interface AgentLoopResult {
  memory: SessionMemory;
  finalStatus: "success" | "failure" | "stuck" | "max-steps" | "timeout";
  summary: string;
}

// Time to wait after each interactive action so the page can settle.
const STEP_SETTLE_MS = 1500;
// Background screenshot interval.
const FRAME_INTERVAL_MS = 1000;

function toArtifactUrl(filePath: string): string {
  const artifactsDir = path.join(config.userDataDir, "artifacts");
  if (filePath.startsWith(artifactsDir)) {
    return "/artifacts" + filePath.slice(artifactsDir.length).replace(/\\/g, "/");
  }
  return filePath;
}

function attachLogListeners(page: Page, logs: string[], networkErrors: string[]) {
  page.on("console", (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
  });
  page.on("pageerror", (err) => {
    logs.push(`[pageerror] ${err.message}`);
  });
  page.on("requestfailed", (req) => {
    networkErrors.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "unknown"}`);
  });
}

async function resolveInputLocator(page: Page, selector: string) {
  const textbox = page.getByRole("textbox", { name: selector, exact: false });
  if ((await textbox.count()) > 0) return textbox;

  const combobox = page.getByRole("combobox", { name: selector, exact: false });
  if ((await combobox.count()) > 0) return combobox;

  const text = page.getByText(selector);
  if ((await text.count()) > 0) return text.locator("..").locator("input, textarea, select").first();

  const looksLikeSelector =
    /^[.#\[>+~:]/.test(selector) ||
    /[=:]/.test(selector) ||
    selector.includes('"') ||
    selector.includes("'");
  if (looksLikeSelector) {
    return page.locator(selector);
  }
  return page.getByLabel(selector, { exact: false });
}

function buildTextLocator(
  page: Page,
  text: string,
  role?: string,
  exact?: boolean
): Locator {
  switch (role) {
    case "button":
      return page.getByRole("button", { name: text, exact });
    case "link":
      return page.getByRole("link", { name: text, exact });
    case "textbox":
      return page.getByRole("textbox", { name: text, exact });
    case "combobox":
      return page.getByRole("combobox", { name: text, exact });
    case "checkbox":
      return page.getByRole("checkbox", { name: text, exact });
    default:
      return page.getByText(text, { exact });
  }
}

async function locateByText(
  page: Page,
  text: string,
  role?: string,
  exact?: boolean,
  context?: string
): Promise<Locator> {
  const globalLocator = buildTextLocator(page, text, role, exact);

  if (!context) {
    return globalLocator.first();
  }

  // Search inside common container elements that contain the context text.
  const container = page
    .locator("article, section, [role='article'], [role='listitem'], li")
    .filter({ hasText: context })
    .first();

  let scoped: Locator;
  switch (role) {
    case "button":
      scoped = container.getByRole("button", { name: text, exact });
      break;
    case "link":
      scoped = container.getByRole("link", { name: text, exact });
      break;
    case "textbox":
      scoped = container.getByRole("textbox", { name: text, exact });
      break;
    case "combobox":
      scoped = container.getByRole("combobox", { name: text, exact });
      break;
    case "checkbox":
      scoped = container.getByRole("checkbox", { name: text, exact });
      break;
    default:
      scoped = container.getByText(text, { exact });
      break;
  }

  try {
    const count = await scoped.count();
    if (count > 0) return scoped.first();
  } catch {
    // ignore and fall back to global
  }

  return globalLocator.first();
}

async function executeAction(page: Page, action: AgentAction): Promise<{ x?: number; y?: number }> {
  switch (action.type) {
    case "navigate":
      await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      return {};
    case "click_text": {
      const exact = action.exact ?? false;
      const target = await locateByText(page, action.text, action.role, exact, action.context);

      let center: { x?: number; y?: number } = {};
      try {
        const box = await target.boundingBox();
        if (box) {
          center = {
            x: Math.round(box.x + box.width / 2),
            y: Math.round(box.y + box.height / 2),
          };
        }
      } catch {
        // ignore bounding box errors
      }

      try {
        await target.click({ timeout: 10000 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes("intercepts pointer events") ||
          message.includes("outside of the viewport")
        ) {
          try {
            await target.click({ force: true, timeout: 5000 });
          } catch {
            await target.evaluate((el: HTMLElement) => el.click());
          }
        } else {
          throw err;
        }
      }
      return center;
    }
    case "click_at": {
      const { x, y } = action;
      try {
        await page.mouse.click(x, y);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("outside of the viewport")) {
          await page.evaluate(
            ({ x, y }) => {
              const el = document.elementFromPoint(x, y) as HTMLElement | null;
              el?.click();
            },
            { x, y }
          );
        } else {
          throw err;
        }
      }
      return { x, y };
    }
    case "type": {
      const locator = (await resolveInputLocator(page, action.selector)).first();
      await locator.scrollIntoViewIfNeeded();
      await locator.fill(action.value);
      return {};
    }
    case "wait":
      await page.waitForTimeout(action.milliseconds);
      return {};
    case "scroll": {
      await page.mouse.wheel(action.deltaX, action.deltaY);
      return {};
    }
    case "commentary":
    case "terminate":
      return {};
    default:
      throw new Error(`Unknown action type`);
  }
}

async function executeActionWithRetry(
  page: Page,
  action: AgentAction
): Promise<{ x?: number; y?: number }> {
  const maxAttempts = 2;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await executeAction(page, action);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        await page.waitForTimeout(500);
      }
    }
  }

  throw lastError ?? new Error("Action execution failed after retries");
}

function buildSystemPrompt(): string {
  return `You are a synthetic QA auditor exploring a web app in a real browser.
Your job is to act like a first-time visitor, understand the page, interact with it, and surface usability or functional issues.

At each turn you will receive:
- The current page URL and title
- A screenshot of the current viewport (included on most turns; in token-thrifty modes it may be omitted on turns where the page has not changed)
- A semantic accessibility tree of interactive elements currently visible in the viewport
- Your previous actions and the resulting pages

Respond with exactly one JSON object matching this schema. The "reasoning" field is REQUIRED for every action.

{
  "type": "click_text" | "click_at" | "type" | "commentary" | "navigate" | "wait" | "scroll" | "terminate",
  "reasoning": "Brief explanation of why this action makes sense",
  // For click_text (preferred way to click when the element has clear text/role):
  "text": "Get Started",
  "role": "button", // optional: button, link, textbox, combobox, checkbox, or generic
  "exact": false, // optional: true = exact text match, false = substring match
  "context": "Introducing Gemini Omni", // optional: nearby heading/card title to disambiguate when multiple elements share the same text
  // For click_at (click a specific point from the accessibility tree):
  "x": 120,
  "y": 340,
  // For type:
  "selector": "The element's visible label / accessible name",
  "value": "text to type",
  // For commentary:
  "text": "Your observation or note",
  "x": 0, "y": 0, // optional anchor point on the current view
  // For navigate:
  "url": "https://...",
  // For wait:
  "milliseconds": 1500,
  // For scroll:
  "deltaX": 0, "deltaY": 500,
  // For terminate:
  "status": "success" | "failure" | "stuck",
  "summary": "Short summary of what you discovered"
}

Guidelines:
- Return ONLY raw, valid JSON. No Markdown, no code blocks, no trailing commentary.
- The "reasoning" field must always be present and must be a string.
- Use click_text to click visible elements that have clear text/role. The accessibility tree gives you the text/label of interactive elements in the viewport.
- Use the exact visible text from the accessibility tree when possible.
- If multiple elements share the same text (e.g. several "Learn more" links), add a "context" field with the nearby heading or card title to pick the right one (e.g. context: "Introducing Gemini Omni").
- For elements with ambiguous text, set exact: false to match a substring.
- Use click_at with coordinates from the accessibility tree when you want to click a specific element that may not have a clean text match, or when click_text keeps failing. The tree includes x, y, width, and height for visible elements.
- Only click coordinates or elements that are currently visible in the viewport.
- Use scroll to move the page up/down/left/right when the target is off-screen. Positive deltaY scrolls down.
- ACTIVELY pursue conversion and sign-up flows. Click CTAs like "Get Started", "Sign Up", etc.
- When you reach a form, interact with it: click into fields, type safe sample values (e.g. "test@example.com"), and submit.
- Do not fill sensitive fields (passwords, credit cards, SSN).
- Add commentary when you notice issues, confusing UI, or interesting details. Anchor the commentary to a coordinate when relevant.
- If you are stuck or the page is not changing, terminate with status "stuck".
- If you have completed a meaningful exploration, terminate with status "success".
- Return ONLY raw, valid JSON. No Markdown, no code blocks.`;
}

function buildUserPrompt(memory: SessionMemory, frame: Frame, domSnapshot: string): string {
  return `Goal: ${memory.goal}
Max remaining turns: ${memory.maxTurns - memory.history.length}

Current page:
- URL: ${frame.url ?? memory.url}
- Title: ${frame.title ?? ""}

Accessibility tree (interactive elements and structure):
${domSnapshot.slice(0, 12000)}

Previous actions:
${formatHistory(memory)}

Choose the next action as a single JSON object.`;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const startTime = Date.now();
  const maxDurationMs = options.maxDurationSeconds ? options.maxDurationSeconds * 1000 : undefined;

  emitRunEvent(options.runId, {
    type: "run.started",
    runId: options.runId,
    timestamp: new Date().toISOString(),
  });

  const { browser, context, page } = await createBrowserContext(
    options.browser,
    options.viewport
  );
  const memory = createMemory(
    options.runId,
    options.url,
    options.goal ?? "Explore the web app as a first-time visitor. Understand its purpose, click primary CTAs and conversion flows, interact with any sign-up or lead-capture forms using safe sample data, and identify usability or functional issues.",
    options.maxSteps ?? 20
  );

  const consoleLogs: string[] = [];
  const networkErrors: string[] = [];
  attachLogListeners(page, consoleLogs, networkErrors);

  let frameIndex = 0;
  let lookIndex = 0;
  let currentFrame: Frame | null = null;
  let lastImageUrl = "";

  let finalStatus: AgentLoopResult["finalStatus"] = "max-steps";
  let summary = "Reached the maximum number of turns.";

  const db = getDb();

  function persistFrame(frame: Frame): void {
    db.prepare(
      `INSERT INTO frames (id, run_id, frame_index, screenshot_path, url, title, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      frame.id,
      frame.runId,
      frame.frameIndex,
      frame.screenshotPath,
      frame.url ?? null,
      frame.title ?? null,
      frame.createdAt
    );
  }

  function persistLook(look: Look): void {
    db.prepare(
      `INSERT INTO looks (id, frame_id, run_id, frame_index, look_index, type, screenshot_path, x, y, width, height, commentary_text, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      look.id,
      look.frameId,
      look.runId,
      look.frameIndex,
      look.lookIndex,
      look.type,
      look.screenshotPath ?? null,
      look.x ?? null,
      look.y ?? null,
      look.width ?? null,
      look.height ?? null,
      look.commentaryText ?? null,
      look.action ?? null,
      look.createdAt
    );
  }

  function persistThought(stepIndex: number, text: string): void {
    const thoughtId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO thoughts (id, run_id, step_index, text, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(thoughtId, options.runId, stepIndex, text, createdAt);
  }

  async function captureCurrentFrame(): Promise<Frame> {
    const capture = await captureFrame(page, { runId: options.runId, frameIndex });
    const frame: Frame = {
      id: crypto.randomUUID(),
      runId: options.runId,
      frameIndex,
      screenshotPath: capture.screenshotPath,
      url: page.url(),
      title: await page.title(),
      createdAt: new Date().toISOString(),
    };
    persistFrame(frame);
    emitRunEvent(options.runId, {
      type: "frame.new",
      frameIndex,
      url: toArtifactUrl(capture.screenshotPath),
      title: frame.title,
      timestamp: frame.createdAt,
    });
    currentFrame = frame;
    frameIndex += 1;
    return frame;
  }

  function recordCommentary(action: AgentAction & { type: "commentary" }): Look {
    if (!currentFrame) throw new Error("No current frame");
    const look: Look = {
      id: crypto.randomUUID(),
      frameId: currentFrame.id,
      runId: options.runId,
      frameIndex: currentFrame.frameIndex,
      lookIndex,
      type: "commentary",
      x: action.x,
      y: action.y,
      commentaryText: action.text,
      createdAt: new Date().toISOString(),
    };
    persistLook(look);
    emitRunEvent(options.runId, {
      type: "look.comment",
      frameIndex: currentFrame.frameIndex,
      lookIndex,
      text: action.text,
      x: action.x,
      y: action.y,
      timestamp: look.createdAt,
    });
    lookIndex += 1;
    return look;
  }

  function recordClick(
    action: AgentAction & { type: "click_text" | "click_at" },
    center: { x?: number; y?: number }
  ): Look {
    if (!currentFrame) throw new Error("No current frame");
    const actionPayload =
      action.type === "click_text"
        ? { text: action.text, role: action.role }
        : { x: action.x, y: action.y };
    const look: Look = {
      id: crypto.randomUUID(),
      frameId: currentFrame.id,
      runId: options.runId,
      frameIndex: currentFrame.frameIndex,
      lookIndex,
      type: "click",
      x: center.x,
      y: center.y,
      action: JSON.stringify(actionPayload),
      createdAt: new Date().toISOString(),
    };
    persistLook(look);
    emitRunEvent(options.runId, {
      type: "look.click",
      frameIndex: currentFrame.frameIndex,
      lookIndex,
      x: center.x,
      y: center.y,
      timestamp: look.createdAt,
    });
    lookIndex += 1;
    return look;
  }

  let frameInterval: ReturnType<typeof setInterval> | null = null;

  try {
    // Initial navigation and first frame.
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await captureCurrentFrame();

    // Capture a fresh screenshot every second in the background.
    frameInterval = setInterval(async () => {
      try {
        await captureCurrentFrame();
      } catch (err) {
        console.error("[agent] background frame capture failed:", err);
      }
    }, FRAME_INTERVAL_MS);

    for (let turn = 0; turn < memory.maxTurns; turn++) {
      if (maxDurationMs && Date.now() - startTime > maxDurationMs) {
        finalStatus = "timeout";
        summary = `Reached the maximum duration of ${options.maxDurationSeconds}s.`;
        break;
      }

      if (!currentFrame) throw new Error("No current frame");

      const domSnapshot = JSON.stringify(await buildSemanticSnapshot(page), null, 2);

      // Decide whether to attach a screenshot this turn based on the configured
      // image-usage mode. This is the main lever for vision-token cost:
      //   high     – full-detail screenshot every step
      //   balanced – low-detail screenshot every step
      //   minimal  – low-detail screenshot only on step 0 / after the page changes
      const imageMode = config.vision.imageMode;
      const imageDetail: "low" | "high" = imageMode === "high" ? "high" : "low";
      const currentUrl = page.url();
      const attachImage =
        imageMode !== "minimal" || turn === 0 || currentUrl !== lastImageUrl;

      let currentViewBase64: string | undefined;
      if (attachImage) {
        currentViewBase64 = `data:image/jpeg;base64,${(
          await page.screenshot({ type: "jpeg", quality: 70, fullPage: false })
        ).toString("base64")}`;
        lastImageUrl = currentUrl;
      }

      const userPrompt = buildUserPrompt(memory, currentFrame, domSnapshot);

      const response = await callLlm<AgentAction>({
        systemPrompt: buildSystemPrompt(),
        userPrompt,
        imageBase64: currentViewBase64,
        imageDetail,
        schema: ActionSchema,
        temperature: 0.2,
        maxTokens: 2048,
        cacheKey: options.runId,
        runId: options.runId,
        stepIndex: lookIndex,
      });

      const action = response.data;
      addTokens(memory, response.tokensUsed);
      addCachedTokens(memory, response.cachedTokens);

      emitRunEvent(options.runId, {
        type: "action",
        stepIndex: lookIndex,
        action: action as any,
        timestamp: new Date().toISOString(),
      });

      if ("reasoning" in action && action.reasoning) {
        const thoughtTimestamp = new Date().toISOString();
        persistThought(lookIndex, action.reasoning);
        emitRunEvent(options.runId, {
          type: "thought",
          stepIndex: lookIndex,
          text: action.reasoning,
          timestamp: thoughtTimestamp,
        });
      }

      // Record the look and execute the action.
      let actionCenter: { x?: number; y?: number } = {};
      switch (action.type) {
        case "commentary": {
          recordCommentary(action);
          break;
        }
        case "click_text":
        case "click_at": {
          try {
            actionCenter = await executeActionWithRetry(page, action);
            await page.waitForTimeout(STEP_SETTLE_MS);
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            consoleLogs.push(`[agent-error] ${errorMessage}`);
            finalStatus = "failure";
            summary = `Action failed: ${errorMessage}`;
          }
          recordClick(action, actionCenter);
          break;
        }
        case "type":
        case "navigate":
        case "wait":
        case "scroll": {
          try {
            actionCenter = await executeActionWithRetry(page, action);
            await page.waitForTimeout(STEP_SETTLE_MS);
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            consoleLogs.push(`[agent-error] ${errorMessage}`);
            finalStatus = "failure";
            summary = `Action failed: ${errorMessage}`;
          }
          break;
        }
        case "terminate": {
          finalStatus = action.status;
          summary = action.summary;
          break;
        }
      }

      addLook(memory, {
        lookIndex,
        frameIndex: currentFrame!.frameIndex,
        action,
        url: page.url(),
        title: await page.title(),
      });

      if (action.type === "terminate" || finalStatus === "failure") {
        break;
      }

      // Clear ephemeral logs for next turn.
      consoleLogs.length = 0;
      networkErrors.length = 0;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    finalStatus = "failure";
    summary = `Run failed: ${errorMessage}`;
  } finally {
    if (frameInterval) clearInterval(frameInterval);
    await context.close();
    await browser.close();
  }

  if (finalStatus === "failure") {
    emitRunEvent(options.runId, {
      type: "run.failed",
      runId: options.runId,
      error: summary,
      timestamp: new Date().toISOString(),
    });
  } else {
    emitRunEvent(options.runId, {
      type: "run.completed",
      runId: options.runId,
      finalStatus,
      summary,
      timestamp: new Date().toISOString(),
    });
  }

  setTimeout(() => removeRunEmitter(options.runId), 2000);

  return { memory, finalStatus, summary };
}
