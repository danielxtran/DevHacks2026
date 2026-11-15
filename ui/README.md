# Pipeline UI

Read-only issue tracker for the backend's current Discovery results. Board, List, and issue details use the backend HTTP API—not the old Supabase `issues`/`ui_issue_meta` prototype tables.

## Run

Use Node.js 22.12 or newer. From the repository root:

```bash
npm --prefix ui ci
npm --prefix ui run dev
```

Open http://127.0.0.1:5173. Start the backend separately (`npm --prefix backend run dev`), or use `./scripts/start.mjs` to start the backend, UI, and both source apps together. Starting the backend also starts collection and can make billable Discovery calls when model credentials are configured.

The UI needs no Supabase or OpenAI credentials. The backend retains its server-only `backend/.env`; the mock source apps still need the shared repository-root `.env`.

Vite proxies `/api/*` to `http://127.0.0.1:3001` for development and preview. If the backend uses another address, start the UI with:

```bash
UI_BACKEND_URL=http://127.0.0.1:3002 npm --prefix ui run dev
```

A separately hosted production bundle needs an equivalent reverse proxy for `/api/*`. No backend credentials belong in browser configuration.

## Live behavior

- Board/List load `GET /issues` and `GET /sources`; only the open issue loads `GET /issues/:id` for its evidence.
- Refresh occurs five seconds after each completed poll. Requests are serialized, timed out, and cancelled on navigation/unmount. The Refresh button fetches current backend state; it does not run Discovery.
- Cards display real summaries, tags, counts, dates, and latest run state. Counts include posts, comments, and replies, not unique players. R is stored as `r` and displayed under the UI's R source tab.
- Source status shows the latest actual collection sweep, including incomplete/failed results and timestamps. This is not a claim that the remote platform is currently healthy.
- Original feedback links open the mock source apps. Source text is rendered as text, never HTML.
- A failed refresh retains the last successful response with a stale-data warning. Initial failure and genuinely empty Discovery results have distinct states. There is no seed/localStorage fallback or generated agent progress.
- Only a recorded human decision closes an issue as Accepted/Rejected. A completed run alone remains awaiting a human decision; failed/interrupted runs remain visible.

Workflow commands, assignments, edits, discussion, artifacts, and playtest pages are not connected in this read-only milestone. Old spec/results URLs show an unavailable state rather than simulated outcomes. Trends and gameplay statistics are not invented from source counts.

The incoming simulator implementation is preserved: `src/simulation/`, simulation components/pages, `src/store/simulation-provider.jsx`, and Hexlab replay code in `tft-clone/`. Both `/api` and `/hexlab-api` proxies are configured. The simulator workflow is not mounted by the live tracker; see [the preserved upstream simulator reference](SIMULATOR.md) for its contracts and walkthrough. The test command runs both live-tracker and simulator tests; its optional live Hexlab check skips unless explicitly configured.

The legacy prototype source/data and Supabase seed tools remain in the repository but are not used by the live tracker. Do not seed the old UI tables to populate this view; populate backend Discovery instead.

## Validation

```bash
npm --prefix ui test
npm --prefix ui run build
npm --prefix ui run lint
npm --prefix backend test
```

The tests use HTTP/persistence mocks and require no database or model credentials. Live database/browser verification is separate; never reset hosted data for a UI check.
