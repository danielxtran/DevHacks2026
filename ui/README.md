# Pipeline UI

The live tracker uses backend-owned Discovery and workflow state, not the old Supabase `issues`/`ui_issue_meta` prototype tables. Issue metadata/assignment, discussion, triage, merge, and experiment-start controls are being connected to the backend. Initial Development, Testing, and review pages are now in the working tree but remain incomplete and unverified; see the [workflow restoration status](../.scratch/restore-workflow-ui/spec.md).

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
- A recorded human decision closes an experiment as Accepted/Rejected; issue triage dismissal is separate. A completed run alone remains awaiting a human decision; failed/interrupted runs remain visible.

The current working tree adds backend command mapping and issue-detail controls for assignment/metadata, discussion, dismiss/restore, merge, and starting an experiment, plus initial Development/Testing/review pages. These changes are uncommitted and unverified. Board/List filtering, command recovery edge cases, and complete history/replay behavior remain; do not infer completion or persistence until migrations, tests, and the live walkthrough pass. Trends and gameplay statistics are not invented from source counts.

The previous simulator implementation is preserved in `src/simulation/`, simulation components/pages, `src/store/simulation-provider.jsx`, and Hexlab replay code in `tft-clone/`. Both `/api` and `/hexlab-api` proxies are configured. The old simulator provider is not the authority for the restored backend workflow; see [the preserved upstream simulator reference](SIMULATOR.md) for component/contract references. The test command runs live-tracker and simulator tests without requiring a running Hexlab service.

The legacy prototype source/data and Supabase seed tools remain in the repository but are not used by the live tracker. Do not seed the old UI tables to populate this view; populate backend Discovery instead.

## Validation

```bash
npm --prefix ui test
npm --prefix ui run build
npm --prefix ui run lint
npm --prefix backend test
```

The tests use HTTP/persistence mocks and require no database or model credentials. Live database/browser verification is separate; never reset hosted data for a UI check.
