-- UI-owned companion tables for the pipeline front end (feat/ui).
--
-- These sit ALONGSIDE the existing run-centric schema (runs, issues, specs,
-- attempts, playtest_reports, balance_versions). They hold the display state
-- the UI needs that the real `issues` table doesn't carry (stage, tags, devs,
-- spec versions, builds, playtests, comments, audit, etc.).
--
-- Issues themselves live in the existing `issues` table. `ui_issue_meta` is a
-- 1:1 companion keyed by issue id.
--
-- RLS is ON. For the hackathon we add permissive anon read+write policies so
-- the browser client (publishable/anon key) can use these tables. Tighten
-- later if needed.

-- ---------------------------------------------------------------------------
-- 1:1 companion to the existing `issues` table.
-- ---------------------------------------------------------------------------
create table if not exists public.ui_issue_meta (
  issue_id       text primary key,
  run_id         uuid,
  title          text not null,
  summary        text,
  game           text,
  stage          text not null default 'feedback',
  status         text not null default 'queued',
  mentions       integer not null default 0,
  first_seen     timestamptz,
  last_mention   timestamptz,
  trend          jsonb not null default '[]'::jsonb,
  sources_detail jsonb not null default '{}'::jsonb,  -- { reddit: n, x: n }
  stat           jsonb,
  change         jsonb,
  tags           jsonb not null default '[]'::jsonb,
  devs           jsonb not null default '[]'::jsonb,
  comments       jsonb not null default '[]'::jsonb,
  audit          jsonb not null default '[]'::jsonb,
  spec_versions  jsonb not null default '[]'::jsonb,
  chat           jsonb not null default '[]'::jsonb,
  build          jsonb,
  builds         jsonb not null default '[]'::jsonb,
  playtest       jsonb,
  playtests      jsonb not null default '[]'::jsonb,
  approvals      jsonb not null default '{}'::jsonb,
  run            jsonb,
  error          jsonb,
  dismissed      boolean not null default false,
  rejection      jsonb,
  merged_into    text,
  merged_from    jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Top-level UI state: source scraper status (reddit / x).
-- ---------------------------------------------------------------------------
create table if not exists public.ui_source_status (
  source     text primary key,              -- 'reddit' | 'x'
  state      text not null default 'ok',     -- ok | retrying | error
  live       boolean not null default false,
  message    text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Top-level UI state: ingest counters (single row).
-- ---------------------------------------------------------------------------
create table if not exists public.ui_ingest (
  id              integer primary key default 1,
  posts_today     integer not null default 0,
  new_since_open  integer not null default 0,
  updated_at      timestamptz not null default now(),
  constraint ui_ingest_singleton check (id = 1)
);

-- ---------------------------------------------------------------------------
-- RLS: on, with permissive anon policies for the hackathon.
-- ---------------------------------------------------------------------------
alter table public.ui_issue_meta    enable row level security;
alter table public.ui_source_status enable row level security;
alter table public.ui_ingest        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ui_issue_meta','ui_source_status','ui_ingest']
  loop
    execute format('drop policy if exists %I on public.%I', t||'_anon_rw', t);
    execute format(
      'create policy %I on public.%I for all to anon using (true) with check (true)',
      t||'_anon_rw', t
    );
    -- also allow authenticated users (if the team logs in later)
    execute format('drop policy if exists %I on public.%I', t||'_auth_rw', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t||'_auth_rw', t
    );
  end loop;
end $$;
