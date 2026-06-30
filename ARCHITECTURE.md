# Tardigrade Architecture

This document records the decisions, intentions, and structure behind Tardigrade.

## Product goal

Build a **general URL-based synthetic user-testing framework** that:

- Drives a real browser via screenshots and interactive actions.
- Audits any public web app or local server (`localhost`) against built-in and custom rubrics.
- Produces an interactive dashboard with replayable sessions, screenshots, and structured evidence.

The user described this as a “QA / product auditor / synthetic unmoderated user test.”

## Core principles

1. **Evidence-first.** Every finding must be linked to observable proof: a screenshot, console log, network error, DOM snippet, or reproduction step.
2. **Rubric-driven.** The framework is built around explicit criteria, not open-ended wandering.
3. **Shareable criteria.** Users can describe a rubric in plain English and get back structured JSON they can save, version, and share.
4. **Local-first.** The app runs on the user’s machine so it can reach `localhost`, keep data private, and avoid hosted-backend costs.
5. **Minimal setup.** One Electron install, no Docker required for normal use.

## Packaging decision: Electron + embedded Node.js backend

We considered four packaging options:

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Electron + embedded Node.js/TS backend | Single install, one language, Playwright via npm, reaches `localhost` | Large bundle from browser binaries | **Chosen** |
| Electron + Docker backend | Isolated runtime | Requires Docker Desktop; more friction | Optional later |
| Electron + embedded Python backend | Single install | Hard to bundle Python + Playwright; OS-specific quirks | Rejected |
| Pure web app | Simplest deploy | Cannot reach user `localhost`; needs hosted backend | Rejected |

The Electron main process spawns the backend as a child process. The renderer talks to the backend over local HTTP. No Docker is required in Phase 1.

Build-time note: the backend build copies `src/rubrics/*.json` into `dist/rubrics/` so the rubric loader can find them at runtime.

## Browser automation: Playwright

Playwright was chosen over BrowserUse/Skyvern wrappers because:

- It supports Chromium, Firefox, and WebKit.
- It gives direct access to screenshots, traces, network logs, and console logs.
- It has first-class Node.js support.
- A custom agent loop lets us enforce strict JSON schemas and inject rubric logic exactly where we want.

We may borrow exploration patterns from BrowserUse or Skyvern later, but we will keep direct control of the loop.

## LLM: any OpenAI-compatible endpoint

Tardigrade talks to a **configurable, OpenAI-compatible Chat Completions API**
through the official `openai` Node SDK. You supply a base URL, API key, and
model; the Settings screen ships presets for OpenAI, Google Gemini, DeepSeek,
Kimi (Moonshot), and Cerebras, and a "Custom" option for any other endpoint
(including local servers like Ollama, LM Studio, or vLLM).

Requirements we lean on:

- **Vision.** The agent reasons over screenshots, so the chosen model must be
  multimodal (e.g. OpenAI `gpt-4o`, Gemini flash). Text-only models such as
  DeepSeek's and Kimi's standard chat models are accepted by the config but
  cannot read screenshots — the UI flags them.
- **Strong JSON output**, which we use for structured actions, rubrics, and
  evaluations. We request JSON whenever possible to keep the agent deterministic
  and easy to parse.
- **OpenAI-compatible shape.** Because every supported provider speaks the same
  request/response format, a single client covers all of them; only the base
  URL, key, and model change.

Cerebras (the project's original default, ~2000 tokens/second) remains a
first-class preset, but it is now one option among many rather than a hard
dependency. Legacy `CEREBRAS_*` environment variables are still read as a
fallback so existing setups keep working.

For offline development and CI, the backend supports `MOCK_LLM=true`, which
returns deterministic placeholder actions and findings without calling any
provider.

## Agent loop design

The agent follows a perception → reasoning → action cycle:

1. **Perception** — capture a compressed screenshot plus a semantic DOM/accessibility snapshot of the current page.
2. **Reasoning** — send the perception plus the current goal and history to the model with a system prompt that demands a JSON action.
3. **Action** — parse the JSON action and execute it via Playwright.
4. **Memory** — record the action, screenshot, logs, and page state.
5. **Termination** — the agent terminates when it reaches a goal, gets stuck, or hits a step limit.

After the loop ends, an evaluator pass scores the recorded session against rubrics and emits findings.

## Rubric model

A rubric set is a JSON file containing one or more criteria. Each rubric has:

- `id`, `name`, `category` (ux | functional | conversion | accessibility | custom)
- `weight` (0–1)
- `criteria` — natural-language instruction for the evaluator
- `requiredEvidence` — which artifacts must be examined
- `scoringType` — pass/fail | 1-5 | present/absent

Users can:

1. Upload a JSON rubric file directly.
2. Paste a plain-English description; a system prompt converts it to structured JSON via the LLM.

The prompt-to-JSON path makes rubrics easy to share as text.

## Evaluation design

After the agent loop finishes, an evaluator pass scores the recorded session against the selected rubric set.

Evaluation strategy:

1. **Load rubrics** — built-in JSON files or user-uploaded/generated sets.
2. **Build context** — summarize the session (URLs visited, actions taken, screenshots, console/network logs).
3. **Per-rubric LLM call** — send the rubric criteria and session context to the model; ask it to return a structured score, severity, description, and evidence references.
4. **Persist findings** — write each finding to SQLite with links to the relevant screenshots/logs.

This keeps scoring explicit and evidence-backed. Each rubric is scored independently so a failure in one criterion does not obscure success in another.

## Dashboard design

The dashboard is intentionally read-only and evidence-centric. It surfaces:

- **Run list** — URL, status, timestamp, token/call counts.
- **Run detail** — summary, sessions replay, findings.
- **Session replay** — a screenshot carousel synced to each agent step, plus the action taken and any console/network logs.
- **Findings** — cards showing score, severity, description, and the specific screenshots or logs that support the conclusion.
- **Settings** — LLM provider/base URL, API key, model name, and default browser. Stored in the user data directory, not the repo.

Design principles:

- Keep the UI dense but scannable; the audience is product/QA people reviewing evidence.
- Every finding must show its evidence; no score without proof.
- Screenshots are loaded from the local filesystem via `file://` URLs in Electron, or served by the backend over HTTP in the renderer.

## Data model

SQLite tables:

- **runs** — audit runs, status, token/call counts, errors.
- **sessions** — individual agent steps with action, screenshot path, DOM snapshot, console logs, network errors.
- **findings** — scored rubric results with evidence.

Screenshots and traces are stored on the filesystem in the user data directory (`~/.tardigrade`).

## Reliability and error handling

The agent loop and evaluator are designed to fail gracefully:

- **Action execution retries:** transient Playwright errors (stale element, timeout) are retried once before the step is marked as failed.
- **LLM parsing failures:** if the model returns malformed JSON or a disallowed action, the loop logs the raw output and terminates the run rather than crashing.
- **Evaluator failures:** if a single rubric cannot be scored, it is recorded as an `info` finding so the rest of the audit still completes.
- **Run-level failures:** any uncaught exception updates the run status to `failed` and stores the error message in the database.
- **Mock mode:** `MOCK_LLM=true` lets developers iterate on the UI and pipeline without a live API key.

## Security and privacy

- The LLM API key is read from `.env` or user settings; it never leaves the local machine except to call the configured provider's endpoint.
- All run data, screenshots, and findings stay in the local SQLite database and user data directory.
- `localhost` targets are reachable because the app runs locally.

## Open decisions

These questions are intentionally deferred or left configurable:

- **Backend framework:** Express vs Fastify — currently Express for familiarity.
- **Playwright install:** Manual prompt; app checks availability and suggests `npx playwright install chromium` if missing.
- **Run execution:** Synchronous for MVP; async queue is a future option.
- **Docker packaging:** Deferred to a later phase.
- **Auth handling (e.g., Google sign-in):** Future feature.
