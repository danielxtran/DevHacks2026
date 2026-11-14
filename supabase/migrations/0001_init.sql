-- =====================================================================
-- Patchwork: initial schema
-- Apply with:  supabase db push      (CLI)   or paste into SQL Editor
--
-- Mental model:
--   balance_versions   = every version of the game's numbers (immutable)
--   feedback_posts     = the untrusted player posts (fixtures)
--   runs               = one press of "Start run"; everything else hangs off it
--     issues           = Agent 1's clustered "megathread" + gate verdict
--     quarantined_posts= posts Agent 1 refused to use (injection / noise)
--     specs            = Agent 2's machine-checkable change requests
--     attempts         = Agent 3's proposed patches + verifier results
--     playtest_reports = win-rate tables from bot playtests
--     llm_calls        = log of every LLM call (latency, tokens, ok)
--   private.seed_sets  = holdout seeds, unreachable from the browser
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ENUMS: a fixed set of allowed values. Postgres rejects anything else,
--    so a typo like 'veryfying' fails loudly instead of silently.
-- ---------------------------------------------------------------------
create type run_mode       as enum ('ours', 'naive');
create type run_status     as enum ('queued', 'collecting', 'gating', 'specing',
                                    'implementing', 'verifying', 'done', 'failed');
create type claim_type     as enum ('too_strong', 'too_weak', 'feels_bad', 'bug', 'other');
create type verdict_type   as enum ('supported', 'not_supported', 'inconclusive', 'out_of_scope');
create type attempt_status as enum ('proposed', 'passed', 'failed', 'needs_human');
create type seed_purpose   as enum ('baseline', 'agent_tool', 'verify', 'eval');


-- ---------------------------------------------------------------------
-- 2. BALANCE VERSIONS: the game's numbers. Never UPDATE a row; a change
--    = a new row pointing at its parent. This gives free history + diffs.
-- ---------------------------------------------------------------------
create table balance_versions (
  id           bigint generated always as identity primary key,
  parent_id    bigint references balance_versions (id),
  run_id       uuid,                                  -- which run created it (null for baseline); FK added below
  units        jsonb  not null,                       -- SPEC §1.3 shape, keyed by unit id
  traits       jsonb  not null,                       -- SPEC §1.5 shape, keyed by trait id
  content_hash text   not null unique,                -- sha256 of canonical JSON, computed by the worker
  label        text,                                  -- 'baseline-v1', 'ISS-001 verified', ...
  created_at   timestamptz not null default now(),
  constraint units_is_object  check (jsonb_typeof(units)  = 'object'),
  constraint traits_is_object check (jsonb_typeof(traits) = 'object')
);
create unique index balance_versions_label_uniq on balance_versions (label) where label is not null;


-- ---------------------------------------------------------------------
-- 3. FEEDBACK POSTS: untrusted input. Shared across runs.
-- ---------------------------------------------------------------------
create table feedback_posts (
  id          text primary key,                       -- 'p017'
  fixture_set text not null default 'v1',
  source      text not null check (source in ('reddit', 'twitch', 'twitter')),
  author      text,
  body        text not null,
  score       int  not null default 0,
  posted_at   timestamptz
);
create index feedback_posts_fixture_set_idx on feedback_posts (fixture_set);


-- ---------------------------------------------------------------------
-- 4. RUNS: the parent of everything. The worker moves `status` through
--    the stages; the frontend watches it live via Realtime.
-- ---------------------------------------------------------------------
create table runs (
  id               uuid primary key default gen_random_uuid(),
  mode             run_mode   not null default 'ours',
  status           run_status not null default 'queued',
  fixture_set      text not null default 'v1',
  base_balance_id  bigint references balance_versions (id),
  final_balance_id bigint references balance_versions (id),
  engine_hash      text,                              -- recorded by worker at claim time (check V6)
  error            text,
  claimed_by       text,                              -- worker hostname
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);
create index runs_status_created_idx on runs (status, created_at);

alter table balance_versions
  add constraint balance_versions_run_fk foreign key (run_id) references runs (id) on delete cascade;


-- ---------------------------------------------------------------------
-- 5. PLAYTEST REPORTS: one row per playtest (baseline, agent tool, verify, eval).
-- ---------------------------------------------------------------------
create table playtest_reports (
  id          bigint generated always as identity primary key,
  run_id      uuid references runs (id) on delete cascade,
  balance_id  bigint not null references balance_versions (id),
  seed_set    text not null check (seed_set in ('dev', 'holdout')),
  games       int  not null check (games > 0),
  purpose     seed_purpose not null,
  units       jsonb not null,  -- { unit_id: {win_rate, ci95:[lo,hi], play_rate, appearances, low_sample} }
  traits      jsonb not null,  -- { "ironclad@4": {...same...} }
  runtime_ms  int,
  created_at  timestamptz not null default now()
);
create index playtest_reports_run_idx on playtest_reports (run_id);


-- ---------------------------------------------------------------------
-- 6. ISSUES: Agent 1's megathread, then stamped by the perception gate.
--    Primary key is (run_id, id) so every run can have its own 'ISS-001'.
-- ---------------------------------------------------------------------
create table issues (
  run_id         uuid not null references runs (id) on delete cascade,
  id             text not null,                       -- 'ISS-001'
  target         text not null,                       -- 'brawler_a' or 'ironclad@4'
  target_type    text not null check (target_type in ('unit', 'trait')),
  claim          claim_type not null,
  post_ids       text[] not null default '{}',
  post_count     int not null default 0,
  weighted_score int,
  sources        text[] not null default '{}',
  quotes         text[] not null default '{}',
  verdict        verdict_type,                        -- null until the gate runs
  evidence       jsonb,                               -- {win_rate, ci95, play_rate, report_id}
  created_at     timestamptz not null default now(),
  primary key (run_id, id)
);


-- ---------------------------------------------------------------------
-- 7. QUARANTINED POSTS: what Agent 1's pre-filter refused to use.
-- ---------------------------------------------------------------------
create table quarantined_posts (
  run_id     uuid not null references runs (id) on delete cascade,
  post_id    text not null references feedback_posts (id),
  reason     text not null check (reason in ('possible_injection', 'noise', 'duplicate')),
  detail     text,                                    -- e.g. which regex matched
  created_at timestamptz not null default now(),
  primary key (run_id, post_id)
);


-- ---------------------------------------------------------------------
-- 8. SPECS: Agent 2's output, one per supported issue.
--    The band is two numeric columns, not a range type, so the React app
--    gets plain numbers instead of a '[0.48,0.54)' string to parse.
-- ---------------------------------------------------------------------
create table specs (
  run_id              uuid not null,
  issue_id            text not null,
  target              text not null,
  rationale           text,
  goal_metric         text    not null default 'win_rate',
  band_low            numeric not null,
  band_high           numeric not null,
  allowed_fields      text[]  not null,
  max_relative_change numeric not null,
  created_at          timestamptz not null default now(),
  primary key (run_id, issue_id),
  foreign key (run_id) references runs (id) on delete cascade,   -- direct link so the API can nest runs → specs
  foreign key (run_id, issue_id) references issues (run_id, id) on delete cascade,
  -- code-enforced limits from SPEC §5.4, also enforced here as a second layer
  constraint band_order   check (band_low < band_high),
  constraint band_in_bal  check (band_low >= 0.45 and band_high <= 0.55),
  constraint max_change   check (max_relative_change > 0 and max_relative_change <= 0.25),
  constraint fields_count check (cardinality(allowed_fields) between 1 and 3)
);


-- ---------------------------------------------------------------------
-- 9. ATTEMPTS: Agent 3's proposals + the verifier's verdict on each.
-- ---------------------------------------------------------------------
create table attempts (
  id                bigint generated always as identity primary key,
  run_id            uuid not null,
  issue_id          text not null,
  attempt_no        int  not null check (attempt_no between 1 and 3),
  changes           jsonb not null,                   -- [{path, from, to}]
  claimed_result    jsonb,                            -- {win_rate: 0.52}
  notes             text,
  status            attempt_status not null default 'proposed',
  checks            jsonb,                            -- {"V1":{"pass":true}, ..., "V8":{"pass":false,"detail":"knight_f 0.57"}}
  feedback_to_agent text,                             -- dev-seed summary only, NEVER holdout numbers
  result_balance_id bigint references balance_versions (id),
  before_report_id  bigint references playtest_reports (id),
  after_report_id   bigint references playtest_reports (id),
  created_at        timestamptz not null default now(),
  verified_at       timestamptz,
  foreign key (run_id) references runs (id) on delete cascade,   -- direct link so the API can nest runs → attempts
  foreign key (run_id, issue_id) references specs (run_id, issue_id) on delete cascade,
  unique (run_id, issue_id, attempt_no),
  constraint changes_is_array check (jsonb_typeof(changes) = 'array')
);
create index attempts_run_idx on attempts (run_id);


-- ---------------------------------------------------------------------
-- 10. LLM CALL LOG: for the "evidence" part of the pitch (latency, tokens, failures).
-- ---------------------------------------------------------------------
create table llm_calls (
  id            bigint generated always as identity primary key,
  run_id        uuid references runs (id) on delete cascade,
  stage         text not null check (stage in ('collector', 'spec_writer', 'implementer')),
  prompt_hash   text,
  latency_ms    int,
  input_tokens  int,
  output_tokens int,
  ok            boolean not null,
  error         text,
  created_at    timestamptz not null default now()
);
create index llm_calls_run_idx on llm_calls (run_id);


-- ---------------------------------------------------------------------
-- 11. SEEDS. Dev seeds are public (agents may use them).
--     Holdout seeds live in the `private` schema, which Supabase's API
--     does not expose, so neither the browser nor the agents can read them.
-- ---------------------------------------------------------------------
create table seed_sets_public (
  name  text primary key check (name = 'dev'),
  seeds int[] not null
);

create schema if not exists private;
create table private.seed_sets (
  name  text primary key,                             -- 'holdout'
  seeds int[] not null
);


-- =====================================================================
-- 12. ROW LEVEL SECURITY
--   Supabase gives the `anon` role (the browser) full table privileges by
--   default; RLS is what actually stops it. With RLS on and ONLY a select
--   policy, the browser can read but every insert/update/delete is denied.
--   The worker uses the service_role key, which bypasses RLS.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'balance_versions', 'feedback_posts', 'runs', 'playtest_reports', 'issues',
    'quarantined_posts', 'specs', 'attempts', 'llm_calls', 'seed_sets_public']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    -- defense in depth: even if someone adds a bad policy later, anon still can't write
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Explicit grants, so this works even with "Automatically expose new tables" OFF.
--   browser roles: read only (RLS policy above still applies)
--   service_role (worker): full access, bypasses RLS
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- The private schema: no access at all for browser roles.
revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
grant usage on schema private to service_role;
grant select on all tables in schema private to service_role;


-- =====================================================================
-- 13. RPC FUNCTIONS (callable via supabase.rpc('name', {...}))
-- =====================================================================

-- 13a. start_run: the ONLY write the browser can do.
-- `security definer` = runs with the function owner's rights, so it can
-- insert even though anon can't. We keep it tiny and validated for that reason.
create or replace function public.start_run(p_mode run_mode default 'ours',
                                            p_fixture_set text default 'v1')
returns uuid
language plpgsql
security definer
set search_path = public          -- stops search_path hijacking in definer functions
as $$
declare
  rid  uuid;
  base bigint;
begin
  if (select count(*) from runs where status not in ('done', 'failed')) >= 2 then
    raise exception 'too many active runs, wait for one to finish';
  end if;

  select id into base from balance_versions where label = 'baseline-v1';
  if base is null then
    raise exception 'no baseline-v1 balance version found';
  end if;

  insert into runs (mode, fixture_set, base_balance_id)
  values (p_mode, p_fixture_set, base)
  returning id into rid;
  return rid;
end $$;
revoke execute on function public.start_run(run_mode, text) from public;
grant  execute on function public.start_run(run_mode, text) to anon, authenticated;


-- 13b. claim_run: the worker atomically grabs the oldest queued run.
-- `for update skip locked` = if two workers ask at once, each gets a
-- different run (or nothing) instead of both grabbing the same one.
-- Returns setof so "nothing queued" is an empty array, not a row of nulls.
create or replace function public.claim_run(p_worker text)
returns setof runs
language sql
security definer
set search_path = public
as $$
  update runs
     set status = 'collecting', claimed_by = p_worker, started_at = now()
   where id = (select id from runs
                where status = 'queued'
                order by created_at
                for update skip locked
                limit 1)
  returning *;
$$;
revoke execute on function public.claim_run(text) from public, anon, authenticated;
grant  execute on function public.claim_run(text) to service_role;


-- 13c. get_holdout_seeds: the verifier's only way to read holdout seeds.
-- The private schema isn't exposed over the API, so the service-role
-- client can't do supabase.schema('private').from(...). This RPC is the bridge.
create or replace function public.get_holdout_seeds()
returns int[]
language sql
security definer
set search_path = private, public
as $$
  select seeds from private.seed_sets where name = 'holdout';
$$;
revoke execute on function public.get_holdout_seeds() from public, anon, authenticated;
grant  execute on function public.get_holdout_seeds() to service_role;


-- =====================================================================
-- 14. REALTIME: tell Supabase to stream row changes for these tables.
--     The React run page subscribes filtered by run_id.
--     RLS still applies to Realtime, and the select policy above allows it.
-- =====================================================================
alter publication supabase_realtime
  add table runs, issues, quarantined_posts, specs, attempts, playtest_reports;
