# Testing Tardigrade

This doc covers how to develop, verify, and debug Tardigrade without needing a live LLM API key.

## Quick verification

From the repo root:

```bash
# Install dependencies
npm install

# Type check everything
npm run typecheck

# Build both packages
npm run build
```

## Run the full Electron app

```bash
npm run dev
```

This starts the Vite dev server and opens Electron. The backend is spawned automatically by the Electron main process.

To test without spending API tokens:

```bash
MOCK_LLM=true npm run dev
```

## Run backend-only examples

Start a local fixture server:

```bash
cd packages/backend/tests/fixtures
python3 -m http.server 8000
```

In another terminal:

```bash
cd packages/backend
MOCK_LLM=true npm run example http://localhost:8000/sample.html default
```

You can also target a different rubric set:

```bash
MOCK_LLM=true npm run example http://localhost:8000/sample.html ux
```

## Run the backend server manually

```bash
cd packages/backend
npm run dev
```

Then hit the endpoints:

```bash
# Health
curl http://localhost:3001/health

# Playwright status
curl http://localhost:3001/playwright-status

# List rubrics
curl http://localhost:3001/rubrics

# Create a run
curl -X POST -H "Content-Type: application/json" \
  -d '{"url":"http://localhost:8000/sample.html","rubricSetId":"default"}' \
  http://localhost:3001/runs

# Get findings (replace <run-id>)
curl http://localhost:3001/runs/<run-id>/findings
```

## Inspect the local database

The SQLite database lives at `~/.tardigrade/tardigrade.db`. You can inspect it with the SQLite CLI:

```bash
sqlite3 ~/.tardigrade/tardigrade.db "SELECT id, url, status, token_count FROM runs;"
```

Or connect with any SQLite viewer.

## Inspect artifacts

Screenshots and DOM snapshots are stored under:

```
~/.tardigrade/artifacts/<run-id>/
```

Each step produces:

- `step-000-screenshot.jpg`
- `step-000-dom.json`

## Run with a real API key

1. Add your key to `packages/backend/.env` or use the in-app Settings screen.
2. Do **not** set `MOCK_LLM`.
3. Submit a run via the UI or API.

```env
LLM_API_KEY=your-key-here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
```

## Expected outputs

A successful mock run against `sample.html` should:

1. Create a run with status `running`.
2. Capture 2 session steps (scroll + terminate).
3. Score all rubrics in the selected set.
4. Mark the run `completed` with `tokenCount` and `llmCallCount` populated.
5. Return findings with screenshot evidence.

## Useful environment variables

| Variable | Purpose |
|----------|---------|
| `MOCK_LLM=true` | Use deterministic placeholder LLM responses |
| `BACKEND_PORT=3002` | Change the backend port if `3001` is taken |
| `NODE_ENV=development` | Dev mode (auto-set by `npm run dev`) |
