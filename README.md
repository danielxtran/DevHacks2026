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
3. In Supabase API settings, expose `public`, `graphql_public`, `mockreddit`, and `mockr` (retain the existing default schemas). The source RPCs are schema-scoped: `mockreddit.listing` and `mockr.search_recent`.
4. Copy `backend/.env.example` to `backend/.env`. Add `SUPABASE_DB_URL` using the project's Postgres connection string from the Supabase Connect panel. Keep this server-only secret out of the root `.env`; use the direct or session-pooler connection. The backend needs it for transactional workflow writes. The browser URL and anon key alone are not enough to run the backend.
5. Hosted Discovery/Design calls additionally need `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` in `backend/.env`.

See [`.env.example`](.env.example) and [`backend/.env.example`](backend/.env.example) for variable names. The project has not applied these migrations to your hosted database; verify the target project and apply them before starting the apps.

## Run the apps

Use Node.js **22.12 or newer**. After configuring the hosted project and environment files above, install dependencies once from the repository root:

```bash
npm --prefix backend ci
npm --prefix ui ci
npm --prefix mockreddit ci
npm --prefix mockr ci
```

Start the backend and all three frontends in one terminal:

```bash
./scripts/start.mjs
```

- Pipeline UI: http://127.0.0.1:5173 (currently a browser-only prototype, not yet connected to the backend)
- Riotdit: http://127.0.0.1:5174
- R: http://127.0.0.1:5175
- Backend: http://127.0.0.1:3001 (`API_PORT` may override this)

The launcher checks dependencies and occupied ports before starting, suppresses automatic browser opening, and stops its app process groups on Ctrl+C or an app exit. It works from any working directory on Linux/macOS/WSL. It does not install packages, apply migrations, reset data, or start the simulator (its current defaults conflict with the dashboard/backend ports). Each app loads its own environment; backend-only secrets are not copied into Vite processes. The backend starts polling and can make billable model calls when credentials are configured.

For one app, use `npm --prefix <app> run dev` instead. Launcher tests use fake app processes and no hosted database/model calls:

```bash
node --test scripts/start.test.mjs
```

The backend loads the repository-root `.env` and binds to loopback. It uses the database URL only on the server. Starting a run also requires `BASELINE_REVISION` and exactly three `SCENARIO_MANIFEST` entries; the external baseline runner is not implemented yet, so the current backend cannot complete a run.

## Backend interface

- `GET /health` — database/source/model configuration status
- `GET /issues` and `GET /issues/:id` — discovered issues and source evidence
- `POST /issues/:id/runs` — `{ "idempotencyKey": "..." }`; returns HTTP 202 after transactional snapshot creation
- `GET /runs/:id` — run status, stage history, and human decision
- `GET /runs/:id/artifacts` and `GET /artifacts/:id` — opaque-ID artifact access
- `POST /runs/:id/resume` — explicitly requeue interrupted work
- `POST /runs/:id/decision` — revision-bound human accept/reject

Source RPC contract examples are in [`docs/contracts/source-rpc-examples.md`](docs/contracts/source-rpc-examples.md). Browser anon permissions allow intended source RPCs but do not allow direct workflow-state writes.
