# Tardigrade Roadmap

## Phase 1 — MVP (current)

Goal: a working end-to-end audit against a single URL with built-in rubrics.

### Week 1: Scaffold ✅

- Electron + Node.js/TypeScript backend workspace
- SQLite schema for runs, sessions, findings
- Health and Playwright status endpoints
- Basic React dashboard (Home, RunDetail, RubricBuilder)
- Type checks and builds pass

### Week 2: Agent loop ✅

- Screenshot + semantic DOM snapshot capture
- OpenAI-compatible LLM client with structured JSON output
- JSON action parser (navigate, click, type, scroll, wait, terminate)
- Agent loop with memory and step limits
- Synchronous run execution wired from `POST /runs`
- `MOCK_LLM=true` mode for offline/CI testing

### Week 3: Rubrics and evaluator ✅

- Load built-in rubric sets from JSON
- Prompt-to-JSON rubric generation endpoint
- Evaluator pass that scores sessions against rubrics
- Finding generation with evidence linking
- Rubric JSON files copied to `dist/` as part of backend build

### Week 4: Dashboard polish ✅

- Session replay (screenshot carousel)
- Finding cards with evidence
- Settings screen (API key, model, browser choice)
- Cost/usage tracking per run

### Week 5: Hardening ✅

- README, architecture docs, example runs
- Test against `localhost` (public URL testing blocked in this environment)
- Error handling and retries in agent loop
- Perception code serialized as string to avoid tsx/esbuild `__name` injection in Playwright evaluate

### Week 5: Hardening

- README, architecture docs, example runs
- Test against public URLs and `localhost`
- Error handling and retries

## Phase 2 — Scale and depth

- Multiple personas / parallel synthetic users
- Multi-browser runs (Firefox, WebKit)
- Baseline comparisons between runs
- Scheduled / cron runs
- Consolidated end-of-run report (scores by category, severity breakdown, top findings with linked evidence)
- PDF / markdown export
- Accessibility integration (axe-core)
- Optional Docker packaging for CI/headless use

## Phase 3 — Enterprise features

- Google / OAuth sign-in handling
- Team sharing of rubric sets
- CI/CD webhook and GitHub Action
- Hosted option (if needed)
