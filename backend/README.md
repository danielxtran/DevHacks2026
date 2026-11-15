# Patchwork backend

The backend is the **only authority** for Patchwork's workflow state. It collects player feedback from Riotdit and R, groups it into issues with the Discovery agent, drafts numeric balance experiments with the Spec Writer, runs them on Hexlab, and records human triage and decisions.

```text
              ┌──────────── source loop (every 5 s) ────────────┐
Riotdit, R ──▶│ SourceCollector ──▶ feedback_posts ──▶ Discovery │──▶ discovered_issues
              └──────────────────────────────────────────────────┘
Pipeline UI ──▶ HTTP API ──▶ repository (transactions) ──▶ workflow_jobs
              ┌──────────── command loop (every 1 s) ───────────┐
              │ WorkflowJobWorker ──▶ Spec Writer · Hexlab       │──▶ spec_versions, hexlab_simulations
              └──────────────────────────────────────────────────┘
```

## Run

```bash
cp .env.example .env     # SUPABASE_DB_URL, OPENAI_API_KEY, OPENAI_MODEL
npm ci
npm run dev              # http://127.0.0.1:3001, with file watching
```

Or start everything from the repository root with `./scripts/start.mjs`.

| Script | Does |
|---|---|
| `npm run dev` | Watch mode via `tsx`. Loads `../.env`, then `.env`. |
| `npm run build` | Compiles to `dist/` |
| `npm start` | Runs `dist/server.js` |
| `npm test` | Builds, then runs `node --test dist/*.test.js` (fully mocked; no database or model calls) |

> [!WARNING]
> Starting the backend starts the polling worker. Once OpenAI credentials are configured, it makes **billable** model calls automatically.

## Requirements

- Node.js 22.12+
- A Supabase Postgres connection string (`SUPABASE_DB_URL`), with migrations `0001`–`0008` applied
- Optional: an OpenAI API key and model (Discovery and the Spec Writer)
- Optional: Hexlab running at `HEXLAB_API_URL` (needed for experiments)

## Documentation

| | |
|---|---|
| [Backend internals](../docs/backend.md) | Loops, collectors, Discovery, Spec Writer, Hexlab client, artifacts |
| [API reference](../docs/api/backend-api.md) | Every endpoint, with examples and error codes |
| [Experiment workflow](../docs/workflow.md) | Lifecycle, revisions, idempotency, generations |
| [Configuration](../docs/configuration.md#backendenv) | Every environment variable |
| [Database](../docs/database.md) | Tables and what writes them |

## Source map

| File | Responsibility |
|---|---|
| `src/server.ts` | Wiring, startup reconciliation, graceful shutdown |
| `src/config.ts` | Environment validation (loopback-only host and Hexlab URL) |
| `src/api.ts` | Routes, and mapping errors to 400 / 404 / 409 / 503 / 500 |
| `src/contracts.ts` | Zod schemas for all inputs and outputs |
| `src/repository.ts` | Transactional commands: sweeps, triage, experiment lifecycle, decisions |
| `src/worker.ts` | Self-scheduling source and command loops |
| `src/source-worker.ts`, `src/collectors.ts` | Paced, paginated, rate-limit-aware collection |
| `src/discovery.ts` | LLM grouping with ID-level output verification |
| `src/workflow-worker.ts` | Spec Writer and simulation jobs, with generation-guarded commits |
| `src/hexlab.ts` | Baseline identity, patch canonicalization, result validation |
| `src/artifact-store.ts` | Immutable files with SHA-256 integrity checks |
| `src/design.ts` | Legacy source-code experiment design (kept for compatibility) |
