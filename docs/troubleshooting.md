# Troubleshooting

## Startup

| Symptom | Cause | Fix |
|---|---|---|
| `Use Node.js 22.12 or newer.` | Old Node | Install Node 22.12+ (`nvm install 22`) |
| `Missing <app> dependencies. Run: npm --prefix <dir> ci` | `node_modules` missing | Run the command it prints |
| `Port 5173 is unavailable (EADDRINUSE)` | Another dev server is running | Stop it (`lsof -i :5173`), or kill a launcher left over from earlier |
| `Configured application ports conflict.` | `API_PORT` or the Hexlab port collides with another app's | Choose distinct ports |
| `SUPABASE_DB_URL is required for backend-only workflow writes.` | `backend/.env` is missing or incomplete | See [Getting started §3](getting-started.md#3-configure-the-backend) |
| `The backend must bind to loopback only.` | `API_HOST` is set to something else | Unset it, or use `127.0.0.1` |
| `HEXLAB_API_URL must be an unauthenticated HTTP URL on loopback.` | HTTPS, a remote host, or credentials in the URL | Use `http://127.0.0.1:<port>/api` |
| `Failed to resolve import "…"` in Vite | Dependencies changed after a pull | Run `npm --prefix <app> ci`, then restart |
| The source API refuses to start because of the key | A service-role or secret key is in `SUPABASE_ANON_KEY` | Use the anon / publishable key |

## Collection

| Symptom | Check |
|---|---|
| `/sources` is empty | No sweep has run yet. Is the backend running? Look for `Source sweep …` in its log. |
| Sweep `failed` | `error` in `/sources`. Usually the source app isn't running, or its API server didn't start (use `npm run dev`, not `dev:web`). |
| Sweep `incomplete`, `error: "item cap reached"` | Raise `COLLECTOR_MAX_ITEMS` (up to 5000) |
| Sweep `incomplete`, no error | Some replies are waiting for their parent in `pending_feedback`. They resolve on later sweeps. |
| Sweeps are slow | Request pacing (1.1 s Riotdit, 5.5 s R) plus any `429` cooldowns. This is expected. |
| `Source identity collision for …` | Two rows claim the same ID with different source identities, usually after hand-editing data. Inspect `feedback_posts`. |
| Everything was re-analyzed once | The spelling of `RIOTDIT_BASE_URL` or `R_BASE_URL` changed, which changes every content fingerprint |

## Discovery

| Symptom | Check |
|---|---|
| Feedback is collected, but no issues appear | `select state, last_error from discovery_queue limit 5;` |
| `Discovery is pending: OPENAI_API_KEY and OPENAI_MODEL are required.` | Set both in `backend/.env` and restart |
| `Discovery referenced feedback outside the supplied evidence.` | The model cited an ID it wasn't given. The batch is retried in 30 s. If it keeps happening, try a stronger model. |
| Model errors such as `401` or `429 insufficient_quota` | Check API billing and the project budget. A ChatGPT subscription doesn't include API usage. |
| Track model usage | `select stage, ok, count(*) from llm_calls group by 1, 2;` |

## Experiments

| Error | Meaning | Fix |
|---|---|---|
| `503 spec_writer_not_configured` | No OpenAI credentials | Configure them and restart |
| `503 hexlab_unavailable` | Hexlab isn't reachable, or its config failed validation | `curl http://127.0.0.1:3002/api/health` |
| `409 developer_assignment_required` | No developer is assigned | Assign one on the issue page |
| `409 active_run_exists` | This issue already has an unfinished experiment (or a merge involves one) | Open that experiment, retry it if failed, or finish its review; experiments on other issues do not block numeric starts |
| `409 *_revision_conflict` | Another tab or person changed the issue or run | Reload and redo the action |
| Run stuck in `spec_queued` | Look at `workflow_jobs` for the run: `state`, `attempt`, `error` | A job at `max_attempts` won't be claimed again |
| Simulation `failed` with `hexlab_baseline_changed` | Hexlab's `champions.json` or engine files changed after the experiment froze its baseline | Restore the original config, or start a new experiment |
| Simulation `failed` with `hexlab_busy` | Hexlab is already running 2 evaluations | Retry |
| Simulation `failed` with `hexlab_timeout` | The evaluation took longer than 125 s | Use fewer battles, or retry |
| `hexlab_result_*_mismatch` | Hexlab returned results that don't match the request | Treat this as a bug and report it with the simulation ID |
| `artifact_integrity_error` | An artifact file was changed or truncated on disk | Don't edit `backend/.artifacts/` |

## Pipeline UI

| Symptom | Check |
|---|---|
| "Disconnected" or stale-data banner | The backend isn't reachable through `/api`. Check `UI_BACKEND_URL` and whether the backend is running. |
| Buttons are disabled with a reason | That text comes from `/capabilities`, which lists the missing configuration |
| "Watch replays" link doesn't load | Start the Hexlab dashboard (port 5176) |

## Resetting demo data

There is **no reset button**, on purpose. Never reset the shared hosted project. To clear live posts in the source apps while keeping the seed data:

```sql
delete from mockr.posts where not is_seed;
delete from mockreddit.comments where not is_seed;
delete from mockreddit.posts where not is_seed;
```

This removes posts from the source sites only. Copies the collector already stored in `public.feedback_posts`, and the issues built from them, stay where they are.
