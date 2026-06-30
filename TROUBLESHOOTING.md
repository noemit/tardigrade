# Troubleshooting

## Backend fails to start: `EADDRINUSE: address already in use :::3001`

Another service is using port `3001`. Set a different port:

```bash
BACKEND_PORT=3002 npm run dev
```

## Playwright status reports `available: false`

Install the browser binaries:

```bash
npx playwright install chromium
```

If you are in a CI/container environment, install dependencies too:

```bash
npx playwright install-deps chromium
```

## `No LLM API key configured`

Add your key to `packages/backend/.env` (or the repo-root `.env`):

```env
LLM_API_KEY=your-key-here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
```

Or set the provider, base URL, key, and model in the in-app **Settings** screen. They are stored in `~/.tardigrade/config.json`.

## Runs fail immediately with network errors

If you are behind a firewall or in a restricted environment, outbound HTTPS may be blocked. Test against a local server first:

```bash
cd packages/backend/tests/fixtures
python3 -m http.server 8000
```

Then submit `http://localhost:8000/sample.html`.

## `page.evaluate: ReferenceError: __name is not defined`

This was caused by tsx/esbuild injecting helper functions into `page.evaluate` callbacks. It has been fixed by passing the browser-side code as a string to `new Function()`. If you reintroduce named functions inside `page.evaluate`, this error can return.

## Findings are empty after a run completes

Check the run status first:

```bash
curl http://localhost:3001/runs/<run-id>
```

If the status is `failed`, the `error` field will explain why. Common causes:

- Missing LLM API key
- Missing Playwright browsers
- Network unreachable
- Rubric JSON files not copied to `dist/rubrics/` (run `npm run build` again)

## Rubric sets are missing from `GET /rubrics`

The backend expects built-in rubric JSON files in `dist/rubrics/`. The build script copies them, but if you are running from `src/` directly with `tsx`, it reads from `src/rubrics/`. Rebuild:

```bash
cd packages/backend
npm run build
```

## SQLite database is locked

Only one backend process should use the database at a time. Kill any lingering backend processes:

```bash
lsof -ti:3001 | xargs kill
```

## Frontend cannot connect to backend

1. Verify the backend is running: `curl http://localhost:3001/health`
2. Check that the frontend is using the correct backend URL. In Electron, it calls `getBackendUrl()` from the main process.
3. If running Vite outside Electron, set `VITE_BACKEND_URL=http://localhost:3001`.

## Screenshots do not load in the dashboard

The backend serves artifacts from `~/.tardigrade/artifacts/` at `/artifacts/`. Verify a screenshot URL directly:

```bash
curl -o /tmp/screenshot.jpg http://localhost:3001/artifacts/<run-id>/step-000-screenshot.jpg
```

If this fails, the run may not have produced screenshots, or the artifact directory is not readable.

## Mock mode returns only `scroll` and `terminate`

That is expected. `MOCK_LLM=true` uses a deterministic sequence so the pipeline can be tested without a live LLM. It is not representative of real model behavior.
