-- Durable local discovery and selected-issue workflow. Keep 0001–0004 unchanged.

alter type public.run_status add value if not exists 'interrupted';
alter type public.run_status add value if not exists 'review';

alter table public.feedback_posts
  add column source_url text,
  add column content_fingerprint text;

create table public.collection_sweeps (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('reddit', 'r')),
  status text not null check (status in ('running', 'complete', 'incomplete', 'failed')),
  pages integer not null default 0 check (pages >= 0),
  items integer not null default 0 check (items >= 0),
  truncated boolean not null default false,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.pending_feedback (
  id text primary key,
  source text not null check (source in ('reddit', 'r')),
  external_id text not null,
  payload jsonb not null,
  last_error text not null default 'parent not present yet',
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create table public.discovered_issues (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  title text not null check (char_length(title) between 1 and 200),
  summary text not null,
  category public.claim_type not null,
  target text,
  target_type text check (target_type in ('unit', 'trait')),
  tags text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'archived')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.discovered_issue_memberships (
  issue_id uuid not null references public.discovered_issues (id) on delete cascade,
  feedback_id text not null references public.feedback_posts (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (issue_id, feedback_id)
);
create index discovered_issue_memberships_feedback_idx on public.discovered_issue_memberships (feedback_id);

create table public.discovery_queue (
  feedback_id text primary key references public.feedback_posts (id) on delete cascade,
  state text not null default 'pending' check (state in ('pending', 'processing')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.runs
  add column selected_issue_id uuid references public.discovered_issues (id) on delete restrict,
  add column idempotency_key text,
  add column request_hash text,
  add column baseline_revision text,
  add column candidate_revision text,
  add column scenario_manifest jsonb,
  add column workflow_stage text not null default 'queued',
  add column current_attempt integer not null default 0 check (current_attempt between 0 and 3);
create unique index runs_idempotency_key_uniq on public.runs (idempotency_key) where idempotency_key is not null;
create index runs_selected_issue_idx on public.runs (selected_issue_id, created_at desc);

alter table public.issues alter column target drop not null;
alter table public.issues alter column target_type drop not null;
alter table public.issues alter column claim drop not null;

create table public.run_feedback_snapshots (
  run_id uuid not null,
  issue_id text not null,
  feedback_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, issue_id, feedback_id),
  foreign key (run_id, issue_id) references public.issues (run_id, id) on delete cascade
);

alter table public.specs
  alter column target drop not null,
  alter column band_low drop not null,
  alter column band_high drop not null,
  alter column allowed_fields drop not null,
  alter column max_relative_change drop not null,
  drop constraint if exists band_order,
  drop constraint if exists band_in_bal,
  drop constraint if exists max_change,
  drop constraint if exists fields_count,
  add column hypothesis text,
  add column evidence_assessment text check (evidence_assessment in ('supported', 'insufficient_evidence')),
  add column evidence_rationale text,
  add column intended_changes jsonb,
  add column preserved_behavior jsonb,
  add column success_criteria jsonb,
  add column original_checks jsonb,
  add column design_artifact_id uuid;

alter table public.attempts
  add column candidate_revision text,
  add column diff_artifact_id uuid,
  add column original_checks_artifact_id uuid,
  add column executed_checks_artifact_id uuid,
  add column verification_changed boolean not null default false;

alter table public.playtest_reports
  alter column balance_id drop not null,
  alter column units drop not null,
  alter column traits drop not null,
  add column code_revision text,
  add column scenario_id text,
  add column scenario_seed bigint,
  add column metrics jsonb,
  add column trace_artifact_id uuid;

alter table public.llm_calls drop constraint if exists llm_calls_stage_check;
alter table public.llm_calls add constraint llm_calls_stage_check
  check (stage in ('collector', 'spec_writer', 'implementer', 'discovery', 'design', 'engineering', 'evaluation'));

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.runs (id) on delete cascade,
  kind text not null check (kind in ('source_evidence', 'baseline', 'design', 'check', 'candidate_diff', 'runner_output', 'simulation', 'evaluation', 'review_packet')),
  relative_path text not null unique,
  media_type text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create table public.run_stage_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.runs (id) on delete cascade,
  stage text not null,
  status text not null check (status in ('started', 'complete', 'failed', 'interrupted')),
  attempt_no integer not null default 0 check (attempt_no between 0 and 3),
  input_artifact_ids uuid[] not null default '{}',
  output_artifact_ids uuid[] not null default '{}',
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index run_stage_events_run_idx on public.run_stage_events (run_id, id);

create table public.human_decisions (
  run_id uuid primary key references public.runs (id) on delete cascade,
  decision text not null check (decision in ('accept', 'reject')),
  reviewer text not null,
  comment text not null default '',
  candidate_revision text not null,
  request_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.collection_sweeps enable row level security;
alter table public.pending_feedback enable row level security;
alter table public.discovered_issues enable row level security;
alter table public.discovered_issue_memberships enable row level security;
alter table public.discovery_queue enable row level security;
alter table public.run_feedback_snapshots enable row level security;
alter table public.artifacts enable row level security;
alter table public.run_stage_events enable row level security;
alter table public.human_decisions enable row level security;

revoke all on public.collection_sweeps, public.pending_feedback, public.discovered_issues,
  public.discovered_issue_memberships, public.discovery_queue, public.run_feedback_snapshots,
  public.artifacts, public.run_stage_events, public.human_decisions from anon, authenticated;
grant all on public.collection_sweeps, public.pending_feedback, public.discovered_issues,
  public.discovered_issue_memberships, public.discovery_queue, public.run_feedback_snapshots,
  public.artifacts, public.run_stage_events, public.human_decisions to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.start_run(public.run_mode, text) from public, anon, authenticated, service_role;

create or replace function public.start_selected_run(
  p_issue_id uuid,
  p_idempotency_key text,
  p_baseline_revision text,
  p_scenarios jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected public.discovered_issues%rowtype;
  existing_id uuid;
  existing_hash text;
  new_id uuid;
  request_fingerprint text;
  issue_text_id text;
begin
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid_idempotency_key';
  end if;
  if p_baseline_revision is null or length(btrim(p_baseline_revision)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid_baseline_revision';
  end if;
  if jsonb_typeof(p_scenarios) <> 'array' or jsonb_array_length(p_scenarios) <> 3 then
    raise exception using errcode = '22023', message = 'exactly_three_scenarios_required';
  end if;

  request_fingerprint := md5(p_issue_id::text || '|' || btrim(p_baseline_revision) || '|' || p_scenarios::text);
  perform pg_advisory_xact_lock(2026040101);

  select id, request_hash into existing_id, existing_hash
    from runs where idempotency_key = btrim(p_idempotency_key);
  if existing_id is not null then
    if existing_hash is distinct from request_fingerprint then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return existing_id;
  end if;

  if exists (select 1 from runs where selected_issue_id is not null and status::text not in ('done', 'failed', 'review')) then
    raise exception using errcode = 'P0001', message = 'active_run_exists';
  end if;

  select * into selected from discovered_issues where id = p_issue_id and status = 'active' for update;
  if selected.id is null then
    raise exception using errcode = 'P0001', message = 'issue_not_found';
  end if;

  insert into runs (mode, fixture_set, status, selected_issue_id, idempotency_key, request_hash,
                    baseline_revision, scenario_manifest, workflow_stage)
  values ('ours', 'mock-live', 'queued', selected.id, btrim(p_idempotency_key), request_fingerprint,
          btrim(p_baseline_revision), p_scenarios, 'queued')
  returning id into new_id;
  issue_text_id := selected.id::text;

  insert into issues (run_id, id, target, target_type, claim, post_ids, post_count, sources, quotes, evidence)
  select new_id, issue_text_id, selected.target, selected.target_type, selected.category,
         coalesce(array_agg(fp.id order by fp.posted_at) filter (where fp.id is not null), '{}'),
         count(fp.id)::integer,
         coalesce(array_agg(distinct fp.source) filter (where fp.source is not null), '{}'),
         coalesce(array_agg(fp.body order by fp.posted_at) filter (where fp.id is not null), '{}'),
         jsonb_build_object('title', selected.title, 'summary', selected.summary, 'tags', selected.tags)
  from discovered_issue_memberships m
  left join feedback_posts fp on fp.id = m.feedback_id
  where m.issue_id = selected.id
  group by selected.target, selected.target_type, selected.category;

  insert into run_feedback_snapshots (run_id, issue_id, feedback_id, payload)
  select new_id, issue_text_id, fp.id, to_jsonb(fp)
  from discovered_issue_memberships m
  join feedback_posts fp on fp.id = m.feedback_id
  where m.issue_id = selected.id;

  insert into run_stage_events (run_id, stage, status)
  values (new_id, 'baseline', 'started');
  return new_id;
end;
$$;
revoke all on function public.start_selected_run(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.start_selected_run(uuid, text, text, jsonb) to service_role;
