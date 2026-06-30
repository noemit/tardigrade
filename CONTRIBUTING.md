# Contributing to Tardigrade

Thanks for your interest! Tardigrade is an early MVP, so issues, ideas, and pull
requests are all welcome.

## Prerequisites

- Node.js 20+
- An API key for any OpenAI-compatible, **multimodal** LLM (for live runs)
- Playwright browsers (for live runs):
  ```bash
  npx playwright install chromium
  ```

## Setup

```bash
git clone https://github.com/noemit/tardigrade.git
cd tardigrade
npm install
cp .env.example .env   # then add your provider, base URL, key, and model
```

## Running

```bash
npm run dev            # Vite dev server + Electron window (spawns the backend)
```

No API key handy? Run the pipeline with deterministic placeholders:

```bash
MOCK_LLM=true npm run dev
```

Or run a backend-only example against a local page:

```bash
cd packages/backend
MOCK_LLM=true npm run example http://localhost:8000/sample.html default
```

## Before you open a PR

Please make sure both checks pass — CI runs the same ones:

```bash
npm run typecheck
npm run build --workspace=packages/backend
npm run build --workspace=packages/frontend
```

Guidelines:

- Keep changes focused and minimal; match the style of the surrounding code.
- If you change configuration, conventions, or workflows, update the relevant
  docs (`README.md`, `ARCHITECTURE.md`, etc.).
- **Never commit secrets.** `.env` is gitignored — keep your keys there, not in
  code or commits.

## Where things live

- `packages/backend/` — Express server, agent loop, evaluator, SQLite, rubrics
- `packages/frontend/` — Electron + Vite + React UI
- See [ARCHITECTURE.md](./ARCHITECTURE.md) for design decisions, and
  [TESTING.md](./TESTING.md) for how to develop and verify.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
