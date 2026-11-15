# Live tracker read contract

The UI uses the backend's existing discovered issues, feedback, runs, decisions, and collection sweeps. No UI companion tables, seed push, schema migration, or browser database/model credentials are needed.

## Board and List

`GET /issues` returns `{ "issues": [...] }`. Each active discovered issue includes:

- `id`, `title`, `summary`, `category`, `target`, `target_type`, `tags`.
- `first_seen_at`, `last_seen_at`, and nullable `last_feedback_at` (latest original feedback timestamp).
- `feedback_count`: distinct issue-membership rows, including posts/comments/replies—not unique players or an engagement-weighted count.
- `source_counts`: `{ "reddit": 3, "r": 2 }`.
- `latest_run`: null or `{ "id", "status", "stage", "error", "attempt", "decision", "reviewer", "decidedAt", "createdAt" }`. The run ID is separate from the issue ID. `decision` is null, `accept`, or `reject`.

Only a saved human decision puts an issue in Closed. Run completion is not acceptance. Failures/interruption remain in their relevant work column; unknown status values are displayed explicitly.

## Saved evidence

`GET /issues/:issueId` returns `{ "issue": { ...fields, "feedback": [...] } }` or 404 for an inactive/missing issue. Invalid UUIDs return 400.

Feedback contains `id`, `source`, `externalId`, `kind`, `title`, `body`, `author`, `score`, `postedAt`, `sourceUrl`, `parentId`, `threadId`, and nullable `numComments`. Rows are ordered by original timestamp and ID. These are current source records, not frozen experiment artifacts. The UI loads evidence only for the open issue, maps stored `r` to its R display key, and renders source content as text with safe HTTP(S) links.

## Source collection

`GET /sources` returns `{ "sources": [...] }`, with the most recently started sweep for each collected source. Each row contains `source`, `status`, `pages`, `items`, `truncated`, `error`, `started_at`, and `completed_at`.

Statuses are `running`, `complete`, `incomplete`, and `failed`. No row means collection has not been observed; it does not mean healthy. A completed sweep is historical collection evidence, not a live platform-health guarantee.

## Refresh and errors

All backend responses use `Cache-Control: no-store`. Vite's development/preview proxy maps `/api/*` to the loopback backend. The UI polls five seconds after each completed request group, with a ten-second timeout per request and cancellation on navigation/unmount. Board/source requests plus at most one open-issue detail request avoid per-card detail fetching.

Initial loading, empty results, unavailable evidence, initial connection failure, and stale previously loaded data are distinct. Failed requests do not substitute prototype data, run browser agents, or mutate server state. Manual Refresh only repeats reads. Workflow commands and artifact pages remain outside this read-only milestone.

Contract tests use mocked HTTP/persistence and require no test database URL. Actual hosted query execution and visual browser verification must be reported separately.
