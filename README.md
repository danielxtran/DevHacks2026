# DevHacks2026

Riotdit and R use one hosted Supabase project. The Vite apps run locally; Supabase supplies Postgres, the PostgREST RPC API, and Realtime. No local Supabase stack or Docker is needed.

## Hosted Supabase setup

1. Put the hosted project's API URL and anon/publishable key in the repository-root `.env`:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-key
   ```

   Both Vite configs load this shared root file. The anon key is public and must be protected by the database's RLS policies; never put a service-role or database password in a `VITE_` variable.

2. For a fresh project, apply migrations `0001`–`0008` in numeric order. For the existing project, **do not replay `0001`–`0004`**: that schema predates migration tracking. Migrations `0005`–`0008` are recorded as applied; see [`supabase/migrations/README.md`](supabase/migrations/README.md) for the project-specific receipt and verification. Never reset existing project data.
3. In Supabase API settings, expose `public`, `graphql_public`, `mockreddit`, and `mockr` (retain the existing default schemas) for the source apps' backing stores. The backend collector reads both sources through their public HTTP APIs and needs no Supabase source credentials.
4. Copy `backend/.env.example` to `backend/.env`. Add `SUPABASE_DB_URL` using the project's Postgres connection string from the Supabase Connect panel. Keep this server-only secret out of the root `.env`; use the direct or session-pooler connection. The backend needs it for transactional workflow writes. The browser URL and anon key alone are not enough to run the backend.
5. Hosted Discovery/Design use the OpenAI Responses API. Create an API key in your [OpenAI project](https://platform.openai.com/api-keys), enable API billing, and set `OPENAI_API_KEY` and `OPENAI_MODEL` in `backend/.env`. Choose a model available to your project that supports Responses function calling; there is no default model. A ChatGPT subscription does not include API usage. Keep the key server-only (never `VITE_`), set a project budget, and restart the backend after changing it. The polling worker can make billable calls automatically.

See [`.env.example`](.env.example) and [`backend/.env.example`](backend/.env.example) for variable names. Migrations `0007` and `0008` were applied to the configured hosted project on 2026-11-15 and verified; review the receipt before applying migrations elsewhere.

## Run the apps

Use Node.js **22.12 or newer**. After configuring the hosted project and environment files above, install dependencies once from the repository root:

```bash
npm --prefix backend ci
npm --prefix ui ci
npm --prefix mockreddit ci
npm --prefix mockr ci
```

### After pulling

If a pull changes an app's `package.json` or `package-lock.json`, reinstall that app and restart its dev server. Vite reads dependencies at startup, so a server left running from before the pull reports errors like `Failed to resolve import "@supabase/supabase-js"`.

```bash
git diff --name-only ORIG_HEAD HEAD -- '*/package*.json'   # which apps changed
npm --prefix <app> ci                                       # e.g. ui, tft-clone
```

Then stop the app with Ctrl+C and start it again (`./scripts/start.mjs` or `npm --prefix <app> run dev`).

Start the backend and all three frontends in one terminal:

```bash
./scripts/start.mjs
```

- Pipeline UI: http://127.0.0.1:5173 (live Discovery board/list/evidence; refreshes every five seconds. Workflow controls are being restored and require migrations `0007`–`0008`.)
- Riotdit: http://127.0.0.1:5174
- R: http://127.0.0.1:5175
- Backend: http://127.0.0.1:3001 (`API_PORT` may override this)

The launcher does not start the Hexlab simulator. Start it separately for backend-owned numeric experiments; configure `HEXLAB_API_URL` only if it is not at the loopback default `http://127.0.0.1:3002/api`. The prior browser-managed simulator workflow is not the live tracker's source of truth. To run Hexlab:

```bash
npm --prefix tft-clone ci
npm --prefix tft-clone run dev   # dashboard http://localhost:5176 · API http://127.0.0.1:3002
```

The launcher checks dependencies and occupied ports before starting, suppresses automatic browser opening, and stops its app process groups on Ctrl+C or an app exit. It works from any working directory on Linux/macOS/WSL. It does not install packages, apply migrations, reset data, or start the Hexlab simulator (see above). Each app loads its own environment; backend-only secrets are not copied into Vite processes. The backend starts polling and can make billable model calls when credentials are configured.

For one app, use `npm --prefix <app> run dev` instead. Launcher tests use fake app processes and no hosted database/model calls:

```bash
node --test scripts/start.test.mjs
```

The legacy simulator workflow reference remains in [ui/SIMULATOR.md](ui/SIMULATOR.md). The restored `hexlab_numeric` path is designed to freeze the actual Hexlab config/engine identity and persist a human-approved numeric experiment through the backend; it does not require fake Git revisions or three source-code scenarios. The new workflow implementation and migrations are still under validation. The retained source-code run path may still require `BASELINE_REVISION` and exactly three `SCENARIO_MANIFEST` entries.

The backend loads the repository-root `.env` and binds to loopback. Database, OpenAI, and workflow state remain server-side. Do not claim hosted persistence or model access until migrations and the operator-approved walkthrough have been verified.

## Source collection

The backend reads public HTTP APIs, without source keys or bearer tokens:

- Riotdit: `GET http://127.0.0.1:5174/r/PatchworkTFT/new.json?limit=100`
- R: `GET http://127.0.0.1:5175/2/tweets/search/recent?query=*&max_results=100`

Override `RIOTDIT_BASE_URL` and `R_BASE_URL` in `backend/.env` when the apps run elsewhere. Start both source apps with `npm run dev` so their API servers run behind the Vite proxies. The source apps retain their root Supabase environment; the backend uses its server-only Postgres connection for persistence.

Sweeps rescan from the newest page, follow pagination, retain comments/replies, and respect rate-limit cooldowns. A slow source delays Discovery and the next source sweep; the working tree adds a separate workflow-command lane, which still needs validation. `COLLECTOR_MAX_ITEMS` caps Riotdit root posts (not inline comments) and R tweets; capped or unresolved-parent results remain incomplete. Changing source URL spelling can change evidence fingerprints and trigger one-time reanalysis.

The Pipeline UI reads these APIs through Vite's `/api` proxy. It needs no browser database/model credentials and does not use the old UI seed tables. Failed refreshes are shown as stale/disconnected, never replaced with prototype data. The backend-owned workflow UI is being restored in phases; current progress and remaining gates are in [the restoration spec](.scratch/restore-workflow-ui/spec.md) and [`ui/README.md`](ui/README.md).

## Backend interface

- `GET /health` — database/source/model configuration status
- `GET /issues`, `GET /issues/:id`, and `GET /issues/:id/runs` — discovered issues, source evidence, and run history
- `GET /sources` and `GET /capabilities` — collection state and workflow capability reasons
- `PATCH /issues/:id`, `POST /issues/:id/comments`, `/dismiss`, `/restore`, `/merge` — durable issue collaboration commands
- `POST /issues/:id/runs` — `{ "idempotencyKey": "...", "actor": "..." }`; returns HTTP 202 after transactional experiment creation and job queueing
- `GET /runs/:id` — run status, stage history, and human decision
- `GET /runs/:id/specs`, `/simulations`, `/artifacts` and `GET /artifacts/:id` — saved versions, simulation history, and opaque-ID artifact access
- `PATCH /runs/:id/specs`, `POST /runs/:id/spec-revisions`, `/spec-approval`, `/spec-rejection`, `/simulations`, `/return-to-development` — versioned human review and queued simulator commands
- `POST /runs/:id/simulations/:simulationId/retry`, `/resume`, and `/decision` — explicit retries and revision-bound human decisions

The source apps' internal RPC examples are retained as historical references in [`docs/contracts/source-rpc-examples.md`](docs/contracts/source-rpc-examples.md); the collector contract is documented in [`docs/contracts/source-http-examples.md`](docs/contracts/source-http-examples.md). Browser anon permissions allow intended source-app operations but do not allow direct workflow-state writes.

## For agents

Mobile accessibility does not matter. This is a dev tool for desktop.
