# Configuration

Each app reads its own environment. There are two env files, and **secrets go only in `backend/.env`**.

| File | Read by | Contains |
|---|---|---|
| `.env` (repository root) | backend, `mockreddit`, `mockr` (both Vite and their API servers) | Public Supabase URL and anon key |
| `backend/.env` | backend only (loaded after the root `.env`) | Database URL, OpenAI key, workflow settings |
| `ui/.env.local` | `ui` (optional, legacy simulator only) | `VITE_HEXLAB_*` overrides |

Both files are gitignored. Copy them from the `.env.example` files next to them.

> [!CAUTION]
> Anything prefixed `VITE_` is bundled into browser JavaScript. Never put `SUPABASE_DB_URL`, a service-role key, or `OPENAI_API_KEY` in a `VITE_` variable or in the root `.env`. The source-app API servers refuse to start if they're given a service-role key.

## Repository root `.env`

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | ✅ | The project's public anon/publishable key. RLS protects the data. |

## `backend/.env`

| Variable | Default | Description |
|---|---|---|
| `SUPABASE_DB_URL` | **required** | Postgres connection string from the Supabase **Connect** panel. Use the direct or session-pooler connection, because the backend relies on transactions and row locks. `DATABASE_URL` is accepted as a fallback. |
| `OPENAI_API_KEY` | (none) | Enables Discovery and the Spec Writer. Without it, feedback stays queued and experiments can't start. |
| `OPENAI_MODEL` | (none) | **No default.** Any model available to your project that supports Responses API function calling. |
| `API_HOST` | `127.0.0.1` | Must be `127.0.0.1`, `::1`, or `localhost`. Any other value is rejected. |
| `API_PORT` | `3001` | Integer from 1 to 65535. The launcher and the UI proxy (`UI_BACKEND_URL`) need to agree on it. |
| `RIOTDIT_BASE_URL` | `http://127.0.0.1:5174` | Riotdit base URL. Must be HTTP(S) with no embedded credentials. |
| `R_BASE_URL` | `http://127.0.0.1:5175` | R base URL. Same rules. |
| `HEXLAB_API_URL` | `http://127.0.0.1:3002/api` | Must be unauthenticated `http://` on loopback. The launcher starts Hexlab on this port. |
| `COLLECTOR_MAX_ITEMS` | `500` | 1–5000. Caps Riotdit root posts and R tweets per sweep. |
| `POLL_INTERVAL_MS` | `5000` | 1000–60000. Delay between source-loop iterations. |
| `ARTIFACT_DIR` | `.artifacts` | Resolved relative to `backend/`. Holds immutable artifacts. |
| `BASELINE_REVISION` | (none) | Legacy source-code path only |
| `SCENARIO_MANIFEST` | `[]` | Legacy source-code path only: a JSON array of exactly three scenarios |

> [!WARNING]
> **Billing.** With `OPENAI_API_KEY` and `OPENAI_MODEL` set, the backend calls the model automatically whenever feedback changes, and whenever someone starts or revises an experiment. A ChatGPT subscription doesn't cover API usage. Set a project budget, and restart the backend after changing the key.

## `ui`

| Variable | Default | Description |
|---|---|---|
| `UI_BACKEND_URL` | `http://127.0.0.1:3001` | Where the Vite dev/preview proxy sends `/api/*`. Set it in your shell, not in a file. |
| `NO_OPEN` | (unset) | Any value stops Vite from opening a browser. The launcher sets it. |
| `VITE_HEXLAB_APP_URL` | `http://127.0.0.1:5176` | Where "Watch replays in Hexlab ↗" links point |
| `VITE_HEXLAB_API_URL` | `/hexlab-api` (proxied) | Legacy browser-managed simulator only |

The `/hexlab-api/*` proxy always forwards to `http://127.0.0.1:3002/api/*`.

## `tft-clone` (Hexlab)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | API port. The launcher derives it from `HEXLAB_API_URL`. |
| `CORS_ORIGINS` | localhost / 127.0.0.1 on 5176, 4176, 5173 | Comma-separated allowed origins |

## `mockreddit` and `mockr`

| Variable | Default | Description |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Falls back to the `VITE_` names | Used by the API server. Must be the anon key; secret keys are refused. |
| `PORT` | `4174` (Riotdit), `4175` (R) | API port; in production (`npm start`), also serves `dist/` |
| `TRUST_PROXY` | (unset) | Set to `1` behind a reverse proxy so per-IP rate limits see real client IPs |

## Launcher (`scripts/start.mjs`)

The launcher reads the root `.env`, then `backend/.env`, then the process environment (later values win), but only to work out ports. It **does not** pass backend secrets to the Vite processes. Before starting anything, it checks:

- Node ≥ 22.12, on Linux, macOS, or WSL
- That each app's dependencies are installed (`node_modules/.bin/<tool>`)
- That every port (`API_PORT`, 5173–5176, and the Hexlab port) is free and no two collide
