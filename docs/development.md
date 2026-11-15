# Development & testing

## Repository layout

```text
DevHacks2026/
├── backend/                 Workflow authority (Express + workers)
│   └── src/
│       ├── server.ts           Entry point: wiring, startup reconciliation, shutdown
│       ├── config.ts           Env parsing and validation
│       ├── api.ts              HTTP routes and error mapping
│       ├── contracts.ts        Zod schemas: requests, model outputs, external payloads
│       ├── repository.ts       Every transactional write
│       ├── worker.ts           Self-scheduling source and command loops
│       ├── source-worker.ts    Runs a sweep for each source
│       ├── collectors.ts       Riotdit and R fetchers, pacing, normalization
│       ├── discovery.ts        Discovery agent
│       ├── workflow-worker.ts  Spec Writer and simulation jobs
│       ├── hexlab.ts           Hexlab client, identity, patch and result validation
│       ├── artifact-store.ts   Immutable artifact files
│       ├── design.ts           Legacy source-code design path
│       └── *.test.ts           node:test suites
├── ui/                      Pipeline UI (React)
│   ├── src/data/live.js        Backend client, response mapping, polling
│   ├── src/pages/              Board, List, IssueLayout, IssueDetail, WorkflowPage, …
│   ├── src/simulation/         Hexlab client and result shaping (also used by the legacy simulator)
│   └── test/                   Live-tracker contract tests
├── tft-clone/               Hexlab simulator, API, and dashboard
├── mockreddit/              Riotdit (mock subreddit)
├── mockr/                   R (mock microblog)
├── supabase/                Migrations and the schema snapshot
├── scripts/start.mjs        Launcher (+ start.test.mjs)
├── tmp/prove-discovery.sh   One-off live Discovery check (billable)
└── docs/                    This documentation
```

## Test suites

None of these need a database, network access, or model credentials. External calls are mocked.

| Suite | Command | Covers |
|---|---|---|
| Backend | `npm --prefix backend test` | Config validation, API routes and error mapping, collectors (pagination, pacing, 429s), contracts, Discovery and Spec Writer output handling, repository transactions, artifact integrity, worker scheduling |
| Pipeline UI | `npm --prefix ui test` | Live-tracker mapping and polling, simulator client, result shaping, reducer |
| Hexlab | `npm --prefix tft-clone test` | Combat engine, reproducibility, validation, API integration (Vitest + Supertest) |
| Riotdit | `npm --prefix mockreddit test` | API routes, with Supabase mocked |
| R | `npm --prefix mockr test` | API routes, with Supabase mocked |
| Launcher | `node --test scripts/start.test.mjs` | Port checks, dependency checks, process supervision (with fake apps) |

### Before you push

```bash
npm --prefix backend test
npm --prefix ui test && npm --prefix ui run lint && npm --prefix ui run build
npm --prefix tft-clone test && npm --prefix tft-clone run build
npm --prefix mockreddit test && npm --prefix mockr test
node --test scripts/start.test.mjs
```

Or all at once:

```bash
for app in backend ui tft-clone mockreddit mockr; do npm --prefix "$app" test || break; done \
  && node --test scripts/start.test.mjs
```

### Live checks

Live checks against the hosted database or real model calls are **separate from the tests** and must be reported separately. Never reset hosted data to make a check pass. `tmp/prove-discovery.sh` runs one real Discovery pass without the polling worker.

## Conventions

These conventions keep the system trustworthy. Reviewers will look for them.

### Backend

- **Validate at the edge.** Every new request body gets a `.strict()` Zod schema in `contracts.ts`. Path IDs go through `uuid.parse`.
- **One transaction per command.** Lock rows with `FOR UPDATE`, check `expectedRevision`, write, increment `revision`, and append `issue_activity`, all inside the same `begin` / `commit`.
- **Throw domain errors** (`ConflictError('snake_case_code')`, `NotFoundError(…)`) and let `api.ts` map them to 409 or 404. Don't hand-write status codes in routes.
- **Queue slow work.** Commands that call OpenAI or Hexlab insert a `workflow_jobs` row and return `202`. They never call out inline.
- **Guard worker commits** with job state, generation, and phase checks, so stale results are dropped.
- **Model calls:** a forced single function call with `strict: true`, `store: false`, Zod re-validation, ID cross-checks, and an `llm_calls` log row. Label player text as untrusted in the prompt.
- **No secrets in logs or responses.** `500` responses return only `internal_error`.

### Frontend

- The Pipeline UI holds **no state of its own**. Every change goes through a backend command, followed by a refresh.
- Render source content as text. Links must be validated HTTP(S).
- Distinguish loading, empty, failed, and stale states. Never fill gaps with seed or demo data.
- Disable controls using the reasons in `/capabilities`, and show the reason.

### Data

- Migrations are forward-only and applied by a person. See the [migration guide](../supabase/migrations/README.md).
- New `public` tables need RLS enabled and `anon` / `authenticated` revoked.

### Hexlab

- Changing anything listed in `src/engine/identity-files.ts` changes `engineId`, and changing a config JSON changes `baselineConfigId`. Either change makes in-flight backend experiments fail with `hexlab_baseline_changed`. That's intended.
- `tft-clone/ARCHITECTURE.md` lists which module owns which contract.

## Branches and commits

- `main` is the integration branch. Work on a feature branch and open a pull request.
- After merging a branch that changes dependencies, reinstall and restart (see [Getting started](getting-started.md#after-you-pull)).
