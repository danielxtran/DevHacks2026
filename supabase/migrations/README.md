# Migrations

These migrations are forward-only SQL files. Nothing applies them automatically: the backend **never** runs migrations at startup. A person applies them, using the Supabase SQL Editor or `psql "$SUPABASE_DB_URL" -f <file>`.

| # | File | Adds |
|---|---|---|
| 0001 | `0001_init.sql` | Original run-centric `public` schema: `runs`, `issues`, `feedback_posts`, `specs`, `attempts`, `playtest_reports`, `llm_calls`, seed sets, and enums |
| 0002 | `0002_mockreddit.sql` | `mockreddit` schema: posts, comments, voting, and listing RPCs with rate limits |
| 0003 | `0003_feedback_threads.sql` | Thread columns on `feedback_posts` (`title`, `parent_id`, `thread_id`, `num_comments`, `kind`) |
| 0004 | `0004_mockr.sql` | `mockr` schema: posts and replies, likes and reposts, `search_recent`. Depends on `public.feedback_posts`. |
| 0005 | `0005_backend_workflow.sql` | Backend-owned collection and Discovery: `collection_sweeps`, `pending_feedback`, `discovered_issues`, memberships, `discovery_queue`, snapshots, `artifacts`, `run_stage_events`, `human_decisions`, plus RLS and revokes |
| 0006 | `0006_agent_artifact_links.sql` | `artifacts.logical_path`; foreign key from `specs` to the design artifact |
| 0007 | `0007_issue_collaboration.sql` | Triage and collaboration: `triage_state`, `assigned_developer`, `human_title` / `human_tags`, merge, dismiss, `revision`, `issue_activity` |
| 0008 | `0008_numeric_experiments.sql` | Numeric Hexlab experiments: new `runs` columns, `spec_versions`, `spec_approvals`, `workflow_jobs`, `hexlab_simulations`, and decision binding |

## A new, empty project

Apply **all eight files in numeric order**. Then go to **Project Settings → Data API → Exposed schemas** and add `mockreddit` and `mockr`, keeping `public` and `graphql_public`.

(`../schema.sql` can bootstrap an empty project in one step, but it is a 2026-11-14 snapshot that predates `0007` and `0008`. If you use it, apply those two afterwards.)

## The shared hosted project

> [!CAUTION]
> **Never replay `0001`–`0004` on the existing hosted project.** That schema was created before migrations were tracked, and replaying it fails or damages data. Never reset the project's data.

The team's hosted project has been recorded as having `0005`–`0008` applied. Before applying anything, **inspect the live schema** and confirm what's missing. For example:

```sql
-- 0007 present?
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'discovered_issues' and column_name = 'triage_state';

-- 0008 present?
select to_regclass('public.workflow_jobs'), to_regclass('public.hexlab_simulations');
```

Apply only the migrations that are missing, one at a time, in order.

### Hosted application receipt

Applied through Supabase MCP to project `qaweuqazcpyvmqbfcgzq` after inspecting schema/history:

| Repository SQL | Hosted version | Hosted name |
|---|---|---|
| `0005_backend_workflow.sql` | `20261114223858` | `backend_workflow` |
| `0006_agent_artifact_links.sql` | `20261114223903` | `agent_artifact_links` |
| `0007_issue_collaboration.sql` | `20261115040853` | `issue_collaboration` |
| `0008_numeric_experiments.sql` | `20261115040908` | `numeric_experiments` |

`0001`–`0004` were not replayed or marked applied. Hosted versions differ from the short local filenames: reconcile history before using CLI `db push`. Post-apply checks confirmed schema, foreign keys, RLS, restricted anon access, and required server grants. Existing counts were unchanged at application time (21 discovered issues, 1 run, 0 decisions); no model call was made as part of applying migrations.

## Writing a new migration

- Name it `NNNN_short_description.sql`, using the next number
- Make it forward-only and additive where possible. Never edit a migration that has already been applied.
- Enable RLS on every new `public` table and `REVOKE ALL … FROM anon, authenticated`. Only the backend writes workflow state.
- Put integrity rules in the schema (`CHECK` constraints, composite foreign keys) rather than relying on application code alone
- Update [`docs/database.md`](../../docs/database.md) and add a row to the table above
