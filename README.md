# DevHacks2026

Riotdit and R use one hosted Supabase project. The Vite apps run locally; Supabase supplies Postgres, the PostgREST RPC API, and Realtime. No local Supabase stack or Docker is needed.

## Hosted Supabase setup

1. Put the hosted project's API URL and anon/publishable key in the repository-root `.env`:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-key
   ```

   Both Vite configs load this shared root file. The anon key is public and must be protected by the database's RLS policies; never put a service-role or database password in a `VITE_` variable.

2. Apply `supabase/migrations/0001_init.sql` through `0006_agent_artifact_links.sql` to the hosted project **in numeric order** using its SQL Editor. Keep the existing project data; do not reset the project.
3. In Supabase API settings, expose `public`, `graphql_public`, `mockreddit`, and `mockr` (retain the existing default schemas) for the source apps' backing stores. The backend collector reads both sources through their public HTTP APIs and needs no Supabase source credentials.
4. Copy `backend/.env.example` to `backend/.env`. Add `SUPABASE_DB_URL` using the project's Postgres connection string from the Supabase Connect panel. Keep this server-only secret out of the root `.env`; use the direct or session-pooler connection. The backend needs it for transactional workflow writes. The browser URL and anon key alone are not enough to run the backend.
5. Hosted Discovery/Design use the OpenAI Responses API. Create an API key in your [OpenAI project](https://platform.openai.com/api-keys), enable API billing, and set `OPENAI_API_KEY` and `OPENAI_MODEL` in `backend/.env`. Choose a model available to your project that supports Responses function calling; there is no default model. A ChatGPT subscription does not include API usage. Keep the key server-only (never `VITE_`), set a project budget, and restart the backend after changing it. The polling worker can make billable calls automatically.

See [`.env.example`](.env.example) and [`backend/.env.example`](backend/.env.example) for variable names. The project has not applied these migrations to your hosted database; verify the target project and apply them before starting the apps.

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

- Pipeline UI: http://127.0.0.1:5173 (live, read-only Discovery board/list/evidence; refreshes every five seconds)
- Riotdit: http://127.0.0.1:5174
- R: http://127.0.0.1:5175
- Backend: http://127.0.0.1:3001 (`API_PORT` may override this)

The launcher does not start the Hexlab simulator. Its code and replay dashboard are preserved, but its browser-managed workflow is not connected to the active live tracker. To run Hexlab separately:

```bash
npm --prefix tft-clone ci
npm --prefix tft-clone run dev   # dashboard http://localhost:5176 · API http://127.0.0.1:3002
```

The launcher checks dependencies and occupied ports before starting, suppresses automatic browser opening, and stops its app process groups on Ctrl+C or an app exit. It works from any working directory on Linux/macOS/WSL. It does not install packages, apply migrations, reset data, or start the Hexlab simulator (see above). Each app loads its own environment; backend-only secrets are not copied into Vite processes. The backend starts polling and can make billable model calls when credentials are configured.

For one app, use `npm --prefix <app> run dev` instead. Launcher tests use fake app processes and no hosted database/model calls:

```bash
node --test scripts/start.test.mjs
```

The preserved simulator workflow calls the Hexlab API through `/hexlab-api`; its original numeric patch contract, measured results, and walkthrough are retained in [ui/SIMULATOR.md](ui/SIMULATOR.md). It can operate independently of the main backend and Supabase, with browser-local review history, but is not mounted by the current live-tracker provider.

The backend loads the repository-root `.env` and binds to loopback. It uses the database URL only on the server. Starting a run also requires `BASELINE_REVISION` and exactly three `SCENARIO_MANIFEST` entries; the external baseline runner is not implemented yet, so the current backend cannot complete a run.

## Source collection

The backend reads public HTTP APIs, without source keys or bearer tokens:

- Riotdit: `GET http://127.0.0.1:5174/r/PatchworkTFT/new.json?limit=100`
- R: `GET http://127.0.0.1:5175/2/tweets/search/recent?query=*&max_results=100`

Override `RIOTDIT_BASE_URL` and `R_BASE_URL` in `backend/.env` when the apps run elsewhere. Start both source apps with `npm run dev` so their API servers run behind the Vite proxies. The source apps retain their root Supabase environment; the backend uses its server-only Postgres connection for persistence.

Sweeps rescan from the newest page, follow pagination, retain comments/replies, and respect rate-limit cooldowns. A slow source delays Discovery and the next worker iteration. `COLLECTOR_MAX_ITEMS` caps Riotdit root posts (not inline comments) and R tweets; capped or unresolved-parent results remain incomplete. Changing source URL spelling can change evidence fingerprints and trigger one-time reanalysis.

The Pipeline UI reads these APIs through Vite's `/api` proxy. It needs no browser database/model credentials and does not use the old UI seed tables. Failed refreshes are shown as stale/disconnected, never replaced with prototype data. Workflow controls and results/artifacts remain unconnected; see [`ui/README.md`](ui/README.md) and the [tracker read contract](docs/contracts/tracker-http-examples.md).

## Backend interface

- `GET /health` — database/source/model configuration status
- `GET /issues` and `GET /issues/:id` — discovered issues, per-source counts, latest run/decision summary, and source evidence
- `GET /sources` — latest actual collection sweep for each source
- `POST /issues/:id/runs` — `{ "idempotencyKey": "..." }`; returns HTTP 202 after transactional snapshot creation
- `GET /runs/:id` — run status, stage history, and human decision
- `GET /runs/:id/artifacts` and `GET /artifacts/:id` — opaque-ID artifact access
- `POST /runs/:id/resume` — explicitly requeue interrupted work
- `POST /runs/:id/decision` — revision-bound human accept/reject

The source apps' internal RPC examples are retained as historical references in [`docs/contracts/source-rpc-examples.md`](docs/contracts/source-rpc-examples.md); the collector contract is documented in [`docs/contracts/source-http-examples.md`](docs/contracts/source-http-examples.md). Browser anon permissions allow intended source-app operations but do not allow direct workflow-state writes.

## For agents

Mobile accessibility does not matter. This is a dev tool for desktop.
