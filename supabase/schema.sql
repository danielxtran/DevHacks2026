-- Application schema snapshot for a NEW, EMPTY Supabase project only.
-- Captured from the hosted application schemas on 2026-11-14.
-- Includes source RPCs, workflow/UI tables, constraints, RLS, grants, and Realtime.
-- Excludes all row data, sequence counters, migration history, and Supabase-managed objects.
-- Do not run against the existing hosted project; this is not an upgrade migration.
BEGIN;
SET LOCAL search_path = public;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $bootstrap$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'mockreddit', 'mockr', 'private')
      AND c.relkind = 'r'
      AND (n.nspname <> 'public' OR c.relname IN ('artifacts', 'attempts', 'balance_versions', 'collection_sweeps', 'discovered_issue_memberships', 'discovered_issues', 'discovery_queue', 'feedback_posts', 'human_decisions', 'issues', 'llm_calls', 'pending_feedback', 'playtest_reports', 'quarantined_posts', 'run_feedback_snapshots', 'run_stage_events', 'runs', 'seed_sets_public', 'specs', 'ui_ingest', 'ui_issue_meta', 'ui_source_status'))
  ) THEN
    RAISE EXCEPTION 'Application tables already exist. schema.sql is for a fresh project only; no changes applied.';
  END IF;
END;
$bootstrap$;

-- Schemas and final enum definitions.
CREATE SCHEMA IF NOT EXISTS mockreddit;
CREATE SCHEMA IF NOT EXISTS mockr;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TYPE "public"."attempt_status" AS ENUM ('proposed', 'passed', 'failed', 'needs_human');
CREATE TYPE "public"."claim_type" AS ENUM ('too_strong', 'too_weak', 'feels_bad', 'bug', 'other');
CREATE TYPE "public"."run_mode" AS ENUM ('ours', 'naive');
CREATE TYPE "public"."run_status" AS ENUM ('queued', 'collecting', 'gating', 'specing', 'implementing', 'verifying', 'done', 'failed', 'interrupted', 'review');
CREATE TYPE "public"."seed_purpose" AS ENUM ('baseline', 'agent_tool', 'verify', 'eval');
CREATE TYPE "public"."verdict_type" AS ENUM ('supported', 'not_supported', 'inconclusive', 'out_of_scope');

-- Tables contain the final column state; no historical ALTER COLUMN chain.
CREATE TABLE "mockr"."posts" (
  id text DEFAULT ((((floor((EXTRACT(epoch FROM clock_timestamp()) * (1000)::numeric)))::bigint * 1000) + (floor((random() * (1000)::double precision)))::bigint))::text NOT NULL,
  author_username text NOT NULL,
  author_name text NOT NULL,
  body text NOT NULL,
  reply_to_id text,
  conversation_id text NOT NULL,
  like_count integer DEFAULT 0 NOT NULL,
  repost_count integer DEFAULT 0 NOT NULL,
  reply_count integer DEFAULT 0 NOT NULL,
  is_seed boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mockreddit"."comments" (
  id text DEFAULT substr(md5(((random())::text || (clock_timestamp())::text)), 1, 7) NOT NULL,
  post_id text NOT NULL,
  parent_id text,
  author text NOT NULL,
  body text NOT NULL,
  score integer DEFAULT 1 NOT NULL,
  is_seed boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "mockreddit"."posts" (
  id text DEFAULT substr(md5(((random())::text || (clock_timestamp())::text)), 1, 7) NOT NULL,
  title text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  author text NOT NULL,
  flair text DEFAULT 'Discussion'::text NOT NULL,
  score integer DEFAULT 1 NOT NULL,
  is_seed boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "private"."seed_sets" (
  name text NOT NULL,
  seeds integer[] NOT NULL
);

CREATE TABLE "public"."artifacts" (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid,
  kind text NOT NULL,
  relative_path text NOT NULL,
  media_type text NOT NULL,
  sha256 text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  logical_path text
);

CREATE TABLE "public"."attempts" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  run_id uuid NOT NULL,
  issue_id text NOT NULL,
  attempt_no integer NOT NULL,
  changes jsonb NOT NULL,
  claimed_result jsonb,
  notes text,
  status attempt_status DEFAULT 'proposed'::attempt_status NOT NULL,
  checks jsonb,
  feedback_to_agent text,
  result_balance_id bigint,
  before_report_id bigint,
  after_report_id bigint,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  verified_at timestamp with time zone,
  candidate_revision text,
  diff_artifact_id uuid,
  original_checks_artifact_id uuid,
  executed_checks_artifact_id uuid,
  verification_changed boolean DEFAULT false NOT NULL
);

CREATE TABLE "public"."balance_versions" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  parent_id bigint,
  run_id uuid,
  units jsonb NOT NULL,
  traits jsonb NOT NULL,
  content_hash text NOT NULL,
  label text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."collection_sweeps" (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  source text NOT NULL,
  status text NOT NULL,
  pages integer DEFAULT 0 NOT NULL,
  items integer DEFAULT 0 NOT NULL,
  truncated boolean DEFAULT false NOT NULL,
  error text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone
);

CREATE TABLE "public"."discovered_issue_memberships" (
  issue_id uuid NOT NULL,
  feedback_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."discovered_issues" (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  fingerprint text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  category claim_type NOT NULL,
  target text,
  target_type text,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."discovery_queue" (
  feedback_id text NOT NULL,
  state text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
  last_error text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."feedback_posts" (
  id text NOT NULL,
  fixture_set text DEFAULT 'v1'::text NOT NULL,
  source text NOT NULL,
  author text,
  body text NOT NULL,
  score integer DEFAULT 0 NOT NULL,
  posted_at timestamp with time zone,
  kind text DEFAULT 'post'::text NOT NULL,
  title text,
  parent_id text,
  thread_id text,
  num_comments integer,
  external_id text,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  source_url text,
  content_fingerprint text
);

CREATE TABLE "public"."human_decisions" (
  run_id uuid NOT NULL,
  decision text NOT NULL,
  reviewer text NOT NULL,
  comment text DEFAULT ''::text NOT NULL,
  candidate_revision text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."issues" (
  run_id uuid NOT NULL,
  id text NOT NULL,
  target text,
  target_type text,
  claim claim_type,
  post_ids text[] DEFAULT '{}'::text[] NOT NULL,
  post_count integer DEFAULT 0 NOT NULL,
  weighted_score integer,
  sources text[] DEFAULT '{}'::text[] NOT NULL,
  quotes text[] DEFAULT '{}'::text[] NOT NULL,
  verdict verdict_type,
  evidence jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."llm_calls" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  run_id uuid,
  stage text NOT NULL,
  prompt_hash text,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  ok boolean NOT NULL,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."pending_feedback" (
  id text NOT NULL,
  source text NOT NULL,
  external_id text NOT NULL,
  payload jsonb NOT NULL,
  last_error text DEFAULT 'parent not present yet'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."playtest_reports" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  run_id uuid,
  balance_id bigint,
  seed_set text NOT NULL,
  games integer NOT NULL,
  purpose seed_purpose NOT NULL,
  units jsonb,
  traits jsonb,
  runtime_ms integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  code_revision text,
  scenario_id text,
  scenario_seed bigint,
  metrics jsonb,
  trace_artifact_id uuid
);

CREATE TABLE "public"."quarantined_posts" (
  run_id uuid NOT NULL,
  post_id text NOT NULL,
  reason text NOT NULL,
  detail text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."run_feedback_snapshots" (
  run_id uuid NOT NULL,
  issue_id text NOT NULL,
  feedback_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."run_stage_events" (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  run_id uuid NOT NULL,
  stage text NOT NULL,
  status text NOT NULL,
  attempt_no integer DEFAULT 0 NOT NULL,
  input_artifact_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  output_artifact_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  error text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone
);

CREATE TABLE "public"."runs" (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  mode run_mode DEFAULT 'ours'::run_mode NOT NULL,
  status run_status DEFAULT 'queued'::run_status NOT NULL,
  fixture_set text DEFAULT 'v1'::text NOT NULL,
  base_balance_id bigint,
  final_balance_id bigint,
  engine_hash text,
  error text,
  claimed_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  selected_issue_id uuid,
  idempotency_key text,
  request_hash text,
  baseline_revision text,
  candidate_revision text,
  scenario_manifest jsonb,
  workflow_stage text DEFAULT 'queued'::text NOT NULL,
  current_attempt integer DEFAULT 0 NOT NULL
);

CREATE TABLE "public"."seed_sets_public" (
  name text NOT NULL,
  seeds integer[] NOT NULL
);

CREATE TABLE "public"."specs" (
  run_id uuid NOT NULL,
  issue_id text NOT NULL,
  target text,
  rationale text,
  goal_metric text DEFAULT 'win_rate'::text NOT NULL,
  band_low numeric,
  band_high numeric,
  allowed_fields text[],
  max_relative_change numeric,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  hypothesis text,
  evidence_assessment text,
  evidence_rationale text,
  intended_changes jsonb,
  preserved_behavior jsonb,
  success_criteria jsonb,
  original_checks jsonb,
  design_artifact_id uuid
);

CREATE TABLE "public"."ui_ingest" (
  id integer DEFAULT 1 NOT NULL,
  posts_today integer DEFAULT 0 NOT NULL,
  new_since_open integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."ui_issue_meta" (
  issue_id text NOT NULL,
  run_id uuid,
  title text NOT NULL,
  summary text,
  game text,
  stage text DEFAULT 'feedback'::text NOT NULL,
  status text DEFAULT 'queued'::text NOT NULL,
  mentions integer DEFAULT 0 NOT NULL,
  first_seen timestamp with time zone,
  last_mention timestamp with time zone,
  trend jsonb DEFAULT '[]'::jsonb NOT NULL,
  sources_detail jsonb DEFAULT '{}'::jsonb NOT NULL,
  stat jsonb,
  change jsonb,
  tags jsonb DEFAULT '[]'::jsonb NOT NULL,
  devs jsonb DEFAULT '[]'::jsonb NOT NULL,
  comments jsonb DEFAULT '[]'::jsonb NOT NULL,
  audit jsonb DEFAULT '[]'::jsonb NOT NULL,
  spec_versions jsonb DEFAULT '[]'::jsonb NOT NULL,
  chat jsonb DEFAULT '[]'::jsonb NOT NULL,
  build jsonb,
  builds jsonb DEFAULT '[]'::jsonb NOT NULL,
  playtest jsonb,
  playtests jsonb DEFAULT '[]'::jsonb NOT NULL,
  approvals jsonb DEFAULT '{}'::jsonb NOT NULL,
  run jsonb,
  error jsonb,
  dismissed boolean DEFAULT false NOT NULL,
  rejection jsonb,
  merged_into text,
  merged_from jsonb DEFAULT '[]'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."ui_source_status" (
  source text NOT NULL,
  state text DEFAULT 'ok'::text NOT NULL,
  live boolean DEFAULT false NOT NULL,
  message text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Constraints follow table creation to support circular references.
ALTER TABLE mockr.posts ADD CONSTRAINT posts_body_check CHECK (char_length(body) >= 1 AND char_length(body) <= 280);
ALTER TABLE mockr.posts ADD CONSTRAINT posts_like_count_check CHECK (like_count >= 0);
ALTER TABLE mockr.posts ADD CONSTRAINT posts_pkey PRIMARY KEY (id);
ALTER TABLE mockr.posts ADD CONSTRAINT posts_reply_count_check CHECK (reply_count >= 0);
ALTER TABLE mockr.posts ADD CONSTRAINT posts_repost_count_check CHECK (repost_count >= 0);
ALTER TABLE mockreddit.comments ADD CONSTRAINT comments_body_check CHECK (char_length(body) >= 1 AND char_length(body) <= 2000);
ALTER TABLE mockreddit.comments ADD CONSTRAINT comments_pkey PRIMARY KEY (id);
ALTER TABLE mockreddit.posts ADD CONSTRAINT posts_body_check CHECK (char_length(body) <= 2000);
ALTER TABLE mockreddit.posts ADD CONSTRAINT posts_flair_check CHECK (flair = ANY (ARRAY['Balance'::text, 'Discussion'::text, 'Meme'::text, 'Clip'::text, 'Question'::text]));
ALTER TABLE mockreddit.posts ADD CONSTRAINT posts_pkey PRIMARY KEY (id);
ALTER TABLE mockreddit.posts ADD CONSTRAINT posts_title_check CHECK (char_length(title) >= 1 AND char_length(title) <= 300);
ALTER TABLE private.seed_sets ADD CONSTRAINT seed_sets_pkey PRIMARY KEY (name);
ALTER TABLE public.artifacts ADD CONSTRAINT artifacts_kind_check CHECK (kind = ANY (ARRAY['source_evidence'::text, 'baseline'::text, 'design'::text, 'check'::text, 'candidate_diff'::text, 'runner_output'::text, 'simulation'::text, 'evaluation'::text, 'review_packet'::text]));
ALTER TABLE public.artifacts ADD CONSTRAINT artifacts_pkey PRIMARY KEY (id);
ALTER TABLE public.artifacts ADD CONSTRAINT artifacts_relative_path_key UNIQUE (relative_path);
ALTER TABLE public.artifacts ADD CONSTRAINT artifacts_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'::text);
ALTER TABLE public.artifacts ADD CONSTRAINT artifacts_size_bytes_check CHECK (size_bytes >= 0);
ALTER TABLE public.attempts ADD CONSTRAINT attempts_attempt_no_check CHECK (attempt_no >= 1 AND attempt_no <= 3);
ALTER TABLE public.attempts ADD CONSTRAINT attempts_pkey PRIMARY KEY (id);
ALTER TABLE public.attempts ADD CONSTRAINT attempts_run_id_issue_id_attempt_no_key UNIQUE (run_id, issue_id, attempt_no);
ALTER TABLE public.attempts ADD CONSTRAINT changes_is_array CHECK (jsonb_typeof(changes) = 'array'::text);
ALTER TABLE public.balance_versions ADD CONSTRAINT balance_versions_content_hash_key UNIQUE (content_hash);
ALTER TABLE public.balance_versions ADD CONSTRAINT balance_versions_pkey PRIMARY KEY (id);
ALTER TABLE public.balance_versions ADD CONSTRAINT traits_is_object CHECK (jsonb_typeof(traits) = 'object'::text);
ALTER TABLE public.balance_versions ADD CONSTRAINT units_is_object CHECK (jsonb_typeof(units) = 'object'::text);
ALTER TABLE public.collection_sweeps ADD CONSTRAINT collection_sweeps_items_check CHECK (items >= 0);
ALTER TABLE public.collection_sweeps ADD CONSTRAINT collection_sweeps_pages_check CHECK (pages >= 0);
ALTER TABLE public.collection_sweeps ADD CONSTRAINT collection_sweeps_pkey PRIMARY KEY (id);
ALTER TABLE public.collection_sweeps ADD CONSTRAINT collection_sweeps_source_check CHECK (source = ANY (ARRAY['reddit'::text, 'r'::text]));
ALTER TABLE public.collection_sweeps ADD CONSTRAINT collection_sweeps_status_check CHECK (status = ANY (ARRAY['running'::text, 'complete'::text, 'incomplete'::text, 'failed'::text]));
ALTER TABLE public.discovered_issue_memberships ADD CONSTRAINT discovered_issue_memberships_pkey PRIMARY KEY (issue_id, feedback_id);
ALTER TABLE public.discovered_issues ADD CONSTRAINT discovered_issues_fingerprint_key UNIQUE (fingerprint);
ALTER TABLE public.discovered_issues ADD CONSTRAINT discovered_issues_pkey PRIMARY KEY (id);
ALTER TABLE public.discovered_issues ADD CONSTRAINT discovered_issues_status_check CHECK (status = ANY (ARRAY['active'::text, 'archived'::text]));
ALTER TABLE public.discovered_issues ADD CONSTRAINT discovered_issues_target_type_check CHECK (target_type = ANY (ARRAY['unit'::text, 'trait'::text]));
ALTER TABLE public.discovered_issues ADD CONSTRAINT discovered_issues_title_check CHECK (char_length(title) >= 1 AND char_length(title) <= 200);
ALTER TABLE public.discovery_queue ADD CONSTRAINT discovery_queue_attempts_check CHECK (attempts >= 0);
ALTER TABLE public.discovery_queue ADD CONSTRAINT discovery_queue_pkey PRIMARY KEY (feedback_id);
ALTER TABLE public.discovery_queue ADD CONSTRAINT discovery_queue_state_check CHECK (state = ANY (ARRAY['pending'::text, 'processing'::text]));
ALTER TABLE public.feedback_posts ADD CONSTRAINT comment_has_no_title CHECK (kind <> 'comment'::text OR title IS NULL);
ALTER TABLE public.feedback_posts ADD CONSTRAINT comment_has_parent CHECK (kind <> 'comment'::text OR parent_id IS NOT NULL AND thread_id IS NOT NULL);
ALTER TABLE public.feedback_posts ADD CONSTRAINT feedback_posts_kind_check CHECK (kind = ANY (ARRAY['post'::text, 'comment'::text]));
ALTER TABLE public.feedback_posts ADD CONSTRAINT feedback_posts_pkey PRIMARY KEY (id);
ALTER TABLE public.feedback_posts ADD CONSTRAINT feedback_posts_source_check CHECK (source = ANY (ARRAY['reddit'::text, 'twitch'::text, 'twitter'::text, 'r'::text]));
ALTER TABLE public.feedback_posts ADD CONSTRAINT feedback_posts_title_check CHECK (char_length(title) <= 300);
ALTER TABLE public.feedback_posts ADD CONSTRAINT post_has_no_parent CHECK (kind <> 'post'::text OR parent_id IS NULL AND thread_id IS NULL);
ALTER TABLE public.human_decisions ADD CONSTRAINT human_decisions_decision_check CHECK (decision = ANY (ARRAY['accept'::text, 'reject'::text]));
ALTER TABLE public.human_decisions ADD CONSTRAINT human_decisions_pkey PRIMARY KEY (run_id);
ALTER TABLE public.issues ADD CONSTRAINT issues_pkey PRIMARY KEY (run_id, id);
ALTER TABLE public.issues ADD CONSTRAINT issues_target_type_check CHECK (target_type = ANY (ARRAY['unit'::text, 'trait'::text]));
ALTER TABLE public.llm_calls ADD CONSTRAINT llm_calls_pkey PRIMARY KEY (id);
ALTER TABLE public.llm_calls ADD CONSTRAINT llm_calls_stage_check CHECK (stage = ANY (ARRAY['collector'::text, 'spec_writer'::text, 'implementer'::text, 'discovery'::text, 'design'::text, 'engineering'::text, 'evaluation'::text]));
ALTER TABLE public.pending_feedback ADD CONSTRAINT pending_feedback_attempts_check CHECK (attempts >= 0);
ALTER TABLE public.pending_feedback ADD CONSTRAINT pending_feedback_pkey PRIMARY KEY (id);
ALTER TABLE public.pending_feedback ADD CONSTRAINT pending_feedback_source_check CHECK (source = ANY (ARRAY['reddit'::text, 'r'::text]));
ALTER TABLE public.pending_feedback ADD CONSTRAINT pending_feedback_source_external_id_key UNIQUE (source, external_id);
ALTER TABLE public.playtest_reports ADD CONSTRAINT playtest_reports_games_check CHECK (games > 0);
ALTER TABLE public.playtest_reports ADD CONSTRAINT playtest_reports_pkey PRIMARY KEY (id);
ALTER TABLE public.playtest_reports ADD CONSTRAINT playtest_reports_seed_set_check CHECK (seed_set = ANY (ARRAY['dev'::text, 'holdout'::text]));
ALTER TABLE public.quarantined_posts ADD CONSTRAINT quarantined_posts_pkey PRIMARY KEY (run_id, post_id);
ALTER TABLE public.quarantined_posts ADD CONSTRAINT quarantined_posts_reason_check CHECK (reason = ANY (ARRAY['possible_injection'::text, 'noise'::text, 'duplicate'::text]));
ALTER TABLE public.run_feedback_snapshots ADD CONSTRAINT run_feedback_snapshots_pkey PRIMARY KEY (run_id, issue_id, feedback_id);
ALTER TABLE public.run_stage_events ADD CONSTRAINT run_stage_events_attempt_no_check CHECK (attempt_no >= 0 AND attempt_no <= 3);
ALTER TABLE public.run_stage_events ADD CONSTRAINT run_stage_events_pkey PRIMARY KEY (id);
ALTER TABLE public.run_stage_events ADD CONSTRAINT run_stage_events_status_check CHECK (status = ANY (ARRAY['started'::text, 'complete'::text, 'failed'::text, 'interrupted'::text]));
ALTER TABLE public.runs ADD CONSTRAINT runs_current_attempt_check CHECK (current_attempt >= 0 AND current_attempt <= 3);
ALTER TABLE public.runs ADD CONSTRAINT runs_pkey PRIMARY KEY (id);
ALTER TABLE public.seed_sets_public ADD CONSTRAINT seed_sets_public_name_check CHECK (name = 'dev'::text);
ALTER TABLE public.seed_sets_public ADD CONSTRAINT seed_sets_public_pkey PRIMARY KEY (name);
ALTER TABLE public.specs ADD CONSTRAINT specs_evidence_assessment_check CHECK (evidence_assessment = ANY (ARRAY['supported'::text, 'insufficient_evidence'::text]));
ALTER TABLE public.specs ADD CONSTRAINT specs_pkey PRIMARY KEY (run_id, issue_id);
ALTER TABLE public.ui_ingest ADD CONSTRAINT ui_ingest_pkey PRIMARY KEY (id);
ALTER TABLE public.ui_ingest ADD CONSTRAINT ui_ingest_singleton CHECK (id = 1);
ALTER TABLE public.ui_issue_meta ADD CONSTRAINT ui_issue_meta_pkey PRIMARY KEY (issue_id);
ALTER TABLE public.ui_source_status ADD CONSTRAINT ui_source_status_pkey PRIMARY KEY (source);
ALTER TABLE mockr.posts ADD CONSTRAINT posts_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES mockr.posts(id) ON DELETE CASCADE;
ALTER TABLE mockreddit.comments ADD CONSTRAINT comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES mockreddit.comments(id) ON DELETE CASCADE;
ALTER TABLE mockreddit.comments ADD CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES mockreddit.posts(id) ON DELETE CASCADE;
ALTER TABLE public.artifacts ADD CONSTRAINT artifacts_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
ALTER TABLE public.attempts ADD CONSTRAINT attempts_after_report_id_fkey FOREIGN KEY (after_report_id) REFERENCES playtest_reports(id);
ALTER TABLE public.attempts ADD CONSTRAINT attempts_before_report_id_fkey FOREIGN KEY (before_report_id) REFERENCES playtest_reports(id);
ALTER TABLE public.attempts ADD CONSTRAINT attempts_result_balance_id_fkey FOREIGN KEY (result_balance_id) REFERENCES balance_versions(id);
ALTER TABLE public.attempts ADD CONSTRAINT attempts_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
ALTER TABLE public.attempts ADD CONSTRAINT attempts_run_id_issue_id_fkey FOREIGN KEY (run_id, issue_id) REFERENCES specs(run_id, issue_id) ON DELETE CASCADE;
ALTER TABLE public.balance_versions ADD CONSTRAINT balance_versions_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES balance_versions(id);
ALTER TABLE public.balance_versions ADD CONSTRAINT balance_versions_run_fk FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
ALTER TABLE public.discovered_issue_memberships ADD CONSTRAINT discovered_issue_memberships_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES feedback_posts(id) ON DELETE RESTRICT;
ALTER TABLE public.discovered_issue_memberships ADD CONSTRAINT discovered_issue_memberships_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES discovered_issues(id) ON DELETE CASCADE;
ALTER TABLE public.discovery_queue ADD CONSTRAINT discovery_queue_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES feedback_posts(id) ON DELETE CASCADE;
ALTER TABLE public.feedback_posts ADD CONSTRAINT feedback_posts_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES feedback_posts(id) ON DELETE CASCADE;
ALTER TABLE public.feedback_posts ADD CONSTRAINT feedback_posts_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES feedback_posts(id) ON DELETE CASCADE;
ALTER TABLE public.human_decisions ADD CONSTRAINT human_decisions_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
ALTER TABLE public.issues ADD CONSTRAINT issues_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
ALTER TABLE public.llm_calls ADD CONSTRAINT llm_calls_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
ALTER TABLE public.playtest_reports ADD CONSTRAINT playtest_reports_balance_id_fkey FOREIGN KEY (balance_id) REFERENCES balance_versions(id);
ALTER TABLE public.playtest_reports ADD CONSTRAINT playtest_reports_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
ALTER TABLE public.playtest_reports ADD CONSTRAINT playtest_reports_trace_artifact_fk FOREIGN KEY (trace_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL;
ALTER TABLE public.quarantined_posts ADD CONSTRAINT quarantined_posts_post_id_fkey FOREIGN KEY (post_id) REFERENCES feedback_posts(id);
ALTER TABLE public.quarantined_posts ADD CONSTRAINT quarantined_posts_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
ALTER TABLE public.run_feedback_snapshots ADD CONSTRAINT run_feedback_snapshots_run_id_issue_id_fkey FOREIGN KEY (run_id, issue_id) REFERENCES issues(run_id, id) ON DELETE CASCADE;
ALTER TABLE public.run_stage_events ADD CONSTRAINT run_stage_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
ALTER TABLE public.runs ADD CONSTRAINT runs_base_balance_id_fkey FOREIGN KEY (base_balance_id) REFERENCES balance_versions(id);
ALTER TABLE public.runs ADD CONSTRAINT runs_final_balance_id_fkey FOREIGN KEY (final_balance_id) REFERENCES balance_versions(id);
ALTER TABLE public.runs ADD CONSTRAINT runs_selected_issue_id_fkey FOREIGN KEY (selected_issue_id) REFERENCES discovered_issues(id) ON DELETE RESTRICT;
ALTER TABLE public.specs ADD CONSTRAINT specs_design_artifact_fk FOREIGN KEY (design_artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL;
ALTER TABLE public.specs ADD CONSTRAINT specs_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
ALTER TABLE public.specs ADD CONSTRAINT specs_run_id_issue_id_fkey FOREIGN KEY (run_id, issue_id) REFERENCES issues(run_id, id) ON DELETE CASCADE;

-- Non-constraint indexes.
CREATE INDEX mockr_posts_conversation_idx ON mockr.posts USING btree (conversation_id, created_at);
CREATE INDEX mockr_posts_created_idx ON mockr.posts USING btree (created_at DESC, id DESC);
CREATE INDEX mockr_posts_reply_to_idx ON mockr.posts USING btree (reply_to_id);
CREATE INDEX comments_post_idx ON mockreddit.comments USING btree (post_id, created_at);
CREATE INDEX posts_created_idx ON mockreddit.posts USING btree (created_at DESC);
CREATE INDEX attempts_run_idx ON public.attempts USING btree (run_id);
CREATE UNIQUE INDEX balance_versions_label_uniq ON public.balance_versions USING btree (label) WHERE (label IS NOT NULL);
CREATE INDEX discovered_issue_memberships_feedback_idx ON public.discovered_issue_memberships USING btree (feedback_id);
CREATE UNIQUE INDEX feedback_posts_external_uniq ON public.feedback_posts USING btree (fixture_set, source, external_id) WHERE (external_id IS NOT NULL);
CREATE INDEX feedback_posts_fixture_set_idx ON public.feedback_posts USING btree (fixture_set);
CREATE INDEX feedback_posts_thread_idx ON public.feedback_posts USING btree (thread_id);
CREATE INDEX llm_calls_run_idx ON public.llm_calls USING btree (run_id);
CREATE INDEX playtest_reports_run_idx ON public.playtest_reports USING btree (run_id);
CREATE INDEX run_stage_events_run_idx ON public.run_stage_events USING btree (run_id, id);
CREATE UNIQUE INDEX runs_idempotency_key_uniq ON public.runs USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX runs_selected_issue_idx ON public.runs USING btree (selected_issue_id, created_at DESC);
CREATE INDEX runs_status_created_idx ON public.runs USING btree (status, created_at);

-- Application RPC definitions. Supabase's rls_auto_enable event trigger is managed separately.
CREATE OR REPLACE FUNCTION mockr."like"(p_id text, p_delta integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'mockr'
AS $function$
declare n int;
begin
  if p_delta not in (-1, 1) then raise exception 'delta must be 1 or -1'; end if;
  update posts set like_count = greatest(like_count + p_delta, 0) where id = p_id returning like_count into n;
  if n is null then raise exception 'not found'; end if;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION mockr.repost(p_id text, p_delta integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'mockr'
AS $function$
declare n int;
begin
  if p_delta not in (-1, 1) then raise exception 'delta must be 1 or -1'; end if;
  update posts set repost_count = greatest(repost_count + p_delta, 0) where id = p_id returning repost_count into n;
  if n is null then raise exception 'not found'; end if;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION mockr.search_recent(p_query text DEFAULT NULL::text, p_max_results integer DEFAULT 10, p_next_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'mockr'
AS $function$
declare
  lim      int := least(greatest(coalesce(p_max_results, 10), 10), 100);
  cursor_p mockr.posts;
  page_ids text[];
  result   jsonb;
begin
  if p_next_token is not null then
    select * into cursor_p from posts where id = p_next_token;
    if cursor_p.id is null then raise exception 'invalid next_token'; end if;
  end if;

  select array_agg(id order by created_at desc, id desc) into page_ids
  from (
    select id, created_at from posts
    where (p_query is null or body ilike '%' || p_query || '%')
      and (cursor_p.id is null
           or (created_at, id) < (cursor_p.created_at, cursor_p.id))
    order by created_at desc, id desc
    limit lim
  ) s;

  page_ids := coalesce(page_ids, '{}');

  select jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'text', p.body,
               'author_id', p.author_username,
               'created_at', to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'conversation_id', p.conversation_id,
               'public_metrics', jsonb_build_object(
                  'like_count', p.like_count, 'retweet_count', p.repost_count,
                  'reply_count', p.reply_count, 'quote_count', 0),
               'referenced_tweets', case when p.reply_to_id is null then '[]'::jsonb
                  else jsonb_build_array(jsonb_build_object('type', 'replied_to', 'id', p.reply_to_id)) end)
             order by p.created_at desc, p.id desc)
      from posts p where p.id = any(page_ids)), '[]'::jsonb),
    'includes', jsonb_build_object('users', coalesce((
      select jsonb_agg(distinct jsonb_build_object(
               'id', p.author_username, 'username', p.author_username, 'name', p.author_name))
      from posts p where p.id = any(page_ids)), '[]'::jsonb)),
    'meta', jsonb_strip_nulls(jsonb_build_object(
      'result_count', cardinality(page_ids),
      'newest_id', page_ids[1],
      'oldest_id', page_ids[cardinality(page_ids)],
      'next_token', case when cardinality(page_ids) = lim then page_ids[cardinality(page_ids)] end)))
  into result;

  return result;
end $function$;

CREATE OR REPLACE FUNCTION mockr.submit_post(p_body text, p_reply_to_id text DEFAULT NULL::text)
 RETURNS mockr.posts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'mockr'
AS $function$
declare
  r      mockr.posts;
  parent mockr.posts;
  suffix text := substr(md5(random()::text), 1, 6);
begin
  p_body := btrim(coalesce(p_body, ''));
  if char_length(p_body) = 0   then raise exception 'post cannot be empty'; end if;
  if char_length(p_body) > 280 then raise exception 'post too long (max 280)'; end if;

  if p_reply_to_id is not null then
    select * into parent from posts where id = p_reply_to_id;
    if parent.id is null then raise exception 'post being replied to not found'; end if;
  end if;

  if (select count(*) from posts where not is_seed and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow down: too many posts in the last minute';
  end if;

  insert into posts (author_username, author_name, body, reply_to_id, conversation_id, is_seed)
  values ('guest_' || suffix, 'Guest ' || upper(substr(suffix, 1, 4)), p_body,
          p_reply_to_id, coalesce(parent.conversation_id, ''), false)
  returning * into r;

  -- a root post is its own conversation
  if p_reply_to_id is null then
    update posts set conversation_id = r.id where id = r.id returning * into r;
  else
    update posts set reply_count = reply_count + 1 where id = p_reply_to_id;
  end if;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION mockreddit._anon_name()
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'mockreddit'
AS $function$
  select 'anon_' || substr(md5(random()::text), 1, 6);
$function$;

CREATE OR REPLACE FUNCTION mockreddit.listing(p_sort text DEFAULT 'new'::text, p_limit integer DEFAULT 25, p_after text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'mockreddit'
AS $function$
declare
  lim       int := least(greatest(coalesce(p_limit, 25), 1), 100);
  after_id  text := nullif(regexp_replace(coalesce(p_after, ''), '^t3_', ''), '');
  children  jsonb;
  last_id   text;
begin
  if p_sort not in ('new', 'hot', 'top') then raise exception 'sort must be new, hot or top'; end if;

  with ranked as (
    select p.*,
           row_number() over (order by
             case when p_sort = 'new' then extract(epoch from p.created_at) end desc nulls last,
             case when p_sort = 'top' then p.score end desc nulls last,
             case when p_sort = 'hot' then p.score / power(extract(epoch from (now() - p.created_at)) / 3600 + 2, 1.5) end desc nulls last,
             p.created_at desc, p.id) as pos
    from posts p
  ),
  start as (
    select coalesce((select pos from ranked where id = after_id), 0) as pos
  ),
  page as (
    select r.* from ranked r, start s where r.pos > s.pos order by r.pos limit lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 't3',
           'data', jsonb_build_object(
             'id', r.id,
             'name', 't3_' || r.id,
             'title', r.title,
             'selftext', r.body,
             'author', r.author,
             'score', r.score,
             'link_flair_text', r.flair,
             'created_utc', floor(extract(epoch from r.created_at))::bigint,
             'num_comments', (select count(*) from comments c where c.post_id = r.id),
             'permalink', '/r/PatchworkTFT/post/' || r.id,
             'subreddit', 'PatchworkTFT',
             'comments', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', c.id, 'name', 't1_' || c.id,
                        'parent_id', case when c.parent_id is null then 't3_' || r.id else 't1_' || c.parent_id end,
                        'author', c.author, 'body', c.body, 'score', c.score,
                        'created_utc', floor(extract(epoch from c.created_at))::bigint)
                      order by c.created_at)
               from comments c where c.post_id = r.id), '[]'::jsonb)
           )) order by r.pos), '[]'::jsonb),
         (array_agg(r.id order by r.pos desc))[1]
    into children, last_id
  from page r;

  return jsonb_build_object(
    'kind', 'Listing',
    'data', jsonb_build_object(
      'after',    case when jsonb_array_length(children) = lim then 't3_' || last_id end,
      'dist',     jsonb_array_length(children),
      'children', children));
end $function$;

CREATE OR REPLACE FUNCTION mockreddit.submit_comment(p_post_id text, p_body text, p_parent_id text DEFAULT NULL::text)
 RETURNS mockreddit.comments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'mockreddit'
AS $function$
declare r mockreddit.comments; par mockreddit.comments;
begin
  p_body := btrim(coalesce(p_body, ''));
  if char_length(p_body) = 0    then raise exception 'comment required'; end if;
  if char_length(p_body) > 2000 then raise exception 'comment too long (max 2000)'; end if;
  if not exists (select 1 from posts where id = p_post_id) then raise exception 'post not found'; end if;

  if p_parent_id is not null then
    select * into par from comments where id = p_parent_id;
    if par.id is null              then raise exception 'parent comment not found'; end if;
    if par.post_id <> p_post_id    then raise exception 'parent is on a different post'; end if;
    if par.parent_id is not null   then raise exception 'replies are only one level deep'; end if;
  end if;

  if (select count(*) from comments where not is_seed and created_at > now() - interval '1 minute') >= 40 then
    raise exception 'slow down: too many comments in the last minute';
  end if;

  insert into comments (post_id, parent_id, author, body, score, is_seed)
  values (p_post_id, p_parent_id, _anon_name(), p_body, 1, false)
  returning * into r;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION mockreddit.submit_post(p_title text, p_body text DEFAULT ''::text, p_flair text DEFAULT 'Discussion'::text)
 RETURNS mockreddit.posts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'mockreddit'
AS $function$
declare r mockreddit.posts;
begin
  p_title := btrim(coalesce(p_title, ''));
  p_body  := btrim(coalesce(p_body, ''));
  if char_length(p_title) = 0     then raise exception 'title required'; end if;
  if char_length(p_title) > 300   then raise exception 'title too long (max 300)'; end if;
  if char_length(p_body)  > 2000  then raise exception 'body too long (max 2000)'; end if;
  if p_flair not in ('Balance','Discussion','Meme','Clip','Question') then
    raise exception 'invalid flair';
  end if;
  if (select count(*) from posts where not is_seed and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow down: too many posts in the last minute';
  end if;

  insert into posts (title, body, author, flair, score, is_seed)
  values (p_title, p_body, _anon_name(), p_flair, 1, false)
  returning * into r;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION mockreddit.vote(p_kind text, p_id text, p_delta integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'mockreddit'
AS $function$
declare new_score int;
begin
  if p_delta not in (-1, 1) then raise exception 'delta must be 1 or -1'; end if;
  if p_kind = 'post' then
    update posts set score = score + p_delta where id = p_id returning score into new_score;
  elsif p_kind = 'comment' then
    update comments set score = score + p_delta where id = p_id returning score into new_score;
  else
    raise exception 'kind must be post or comment';
  end if;
  if new_score is null then raise exception 'not found'; end if;
  return new_score;
end $function$;

CREATE OR REPLACE FUNCTION public.claim_run(p_worker text)
 RETURNS SETOF runs
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update runs
     set status = 'collecting', claimed_by = p_worker, started_at = now()
   where id = (select id from runs
                where status = 'queued'
                order by created_at
                for update skip locked
                limit 1)
  returning *;
$function$;

CREATE OR REPLACE FUNCTION public.get_holdout_seeds()
 RETURNS integer[]
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'private', 'public'
AS $function$
  select seeds from private.seed_sets where name = 'holdout';
$function$;

CREATE OR REPLACE FUNCTION public.start_run(p_mode run_mode DEFAULT 'ours'::run_mode, p_fixture_set text DEFAULT 'v1'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.start_selected_run(p_issue_id uuid, p_idempotency_key text, p_baseline_revision text, p_scenarios jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- Explicit security state; preserve the hosted application's existing policies.
ALTER TABLE "mockr"."posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mockreddit"."comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mockreddit"."posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "private"."seed_sets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."balance_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."collection_sweeps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."discovered_issue_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."discovered_issues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."discovery_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."feedback_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."human_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."issues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."llm_calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."pending_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."playtest_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."quarantined_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."run_feedback_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."run_stage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."seed_sets_public" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."specs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ui_ingest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ui_issue_meta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ui_source_status" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON mockr.posts AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON mockreddit.comments AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON mockreddit.posts AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON public.attempts AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON public.balance_versions AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON public.feedback_posts AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON public.issues AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON public.llm_calls AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON public.playtest_reports AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON public.quarantined_posts AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON public.runs AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON public.seed_sets_public AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON public.specs AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY ui_ingest_anon_rw ON public.ui_ingest AS PERMISSIVE FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY ui_ingest_auth_rw ON public.ui_ingest AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY ui_issue_meta_anon_rw ON public.ui_issue_meta AS PERMISSIVE FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY ui_issue_meta_auth_rw ON public.ui_issue_meta AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY ui_source_status_anon_rw ON public.ui_source_status AS PERMISSIVE FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY ui_source_status_auth_rw ON public.ui_source_status AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Clear fresh-project default app-role permissions before restoring the snapshot grants.
REVOKE ALL ON SCHEMA "public" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SCHEMA "mockreddit" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SCHEMA "mockr" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SCHEMA "private" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "mockr"."posts" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "mockreddit"."comments" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "mockreddit"."posts" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "private"."seed_sets" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."artifacts" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."attempts" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."balance_versions" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."collection_sweeps" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."discovered_issue_memberships" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."discovered_issues" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."discovery_queue" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."feedback_posts" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."human_decisions" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."issues" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."llm_calls" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."pending_feedback" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."playtest_reports" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."quarantined_posts" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."run_feedback_snapshots" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."run_stage_events" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."runs" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."seed_sets_public" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."specs" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."ui_ingest" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."ui_issue_meta" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE "public"."ui_source_status" FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.attempts_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.balance_versions_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.llm_calls_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.playtest_reports_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.run_stage_events_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mockr."like"(text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mockr.repost(text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mockr.search_recent(text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mockr.submit_post(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mockreddit._anon_name() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mockreddit.listing(text, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mockreddit.submit_comment(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mockreddit.submit_post(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mockreddit.vote(text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_run(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_holdout_seeds() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_run(run_mode, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.start_selected_run(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Existing schema, table, sequence, and RPC grants; no credentials or custom login roles.
GRANT USAGE ON SCHEMA mockr TO anon;
GRANT USAGE ON SCHEMA mockr TO authenticated;
GRANT USAGE ON SCHEMA mockr TO service_role;
GRANT USAGE ON SCHEMA mockreddit TO anon;
GRANT USAGE ON SCHEMA mockreddit TO authenticated;
GRANT USAGE ON SCHEMA mockreddit TO service_role;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT USAGE ON SCHEMA public TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT DELETE ON TABLE mockr.posts TO service_role;
GRANT DELETE ON TABLE mockreddit.comments TO service_role;
GRANT DELETE ON TABLE mockreddit.posts TO service_role;
GRANT DELETE ON TABLE public.artifacts TO service_role;
GRANT DELETE ON TABLE public.attempts TO service_role;
GRANT DELETE ON TABLE public.balance_versions TO service_role;
GRANT DELETE ON TABLE public.collection_sweeps TO service_role;
GRANT DELETE ON TABLE public.discovered_issue_memberships TO service_role;
GRANT DELETE ON TABLE public.discovered_issues TO service_role;
GRANT DELETE ON TABLE public.discovery_queue TO service_role;
GRANT DELETE ON TABLE public.feedback_posts TO service_role;
GRANT DELETE ON TABLE public.human_decisions TO service_role;
GRANT DELETE ON TABLE public.issues TO service_role;
GRANT DELETE ON TABLE public.llm_calls TO service_role;
GRANT DELETE ON TABLE public.pending_feedback TO service_role;
GRANT DELETE ON TABLE public.playtest_reports TO service_role;
GRANT DELETE ON TABLE public.quarantined_posts TO service_role;
GRANT DELETE ON TABLE public.run_feedback_snapshots TO service_role;
GRANT DELETE ON TABLE public.run_stage_events TO service_role;
GRANT DELETE ON TABLE public.runs TO service_role;
GRANT DELETE ON TABLE public.seed_sets_public TO service_role;
GRANT DELETE ON TABLE public.specs TO service_role;
GRANT DELETE ON TABLE public.ui_ingest TO anon;
GRANT DELETE ON TABLE public.ui_ingest TO authenticated;
GRANT DELETE ON TABLE public.ui_ingest TO service_role;
GRANT DELETE ON TABLE public.ui_issue_meta TO anon;
GRANT DELETE ON TABLE public.ui_issue_meta TO authenticated;
GRANT DELETE ON TABLE public.ui_issue_meta TO service_role;
GRANT DELETE ON TABLE public.ui_source_status TO anon;
GRANT DELETE ON TABLE public.ui_source_status TO authenticated;
GRANT DELETE ON TABLE public.ui_source_status TO service_role;
GRANT INSERT ON TABLE mockr.posts TO service_role;
GRANT INSERT ON TABLE mockreddit.comments TO service_role;
GRANT INSERT ON TABLE mockreddit.posts TO service_role;
GRANT INSERT ON TABLE public.artifacts TO service_role;
GRANT INSERT ON TABLE public.attempts TO service_role;
GRANT INSERT ON TABLE public.balance_versions TO service_role;
GRANT INSERT ON TABLE public.collection_sweeps TO service_role;
GRANT INSERT ON TABLE public.discovered_issue_memberships TO service_role;
GRANT INSERT ON TABLE public.discovered_issues TO service_role;
GRANT INSERT ON TABLE public.discovery_queue TO service_role;
GRANT INSERT ON TABLE public.feedback_posts TO service_role;
GRANT INSERT ON TABLE public.human_decisions TO service_role;
GRANT INSERT ON TABLE public.issues TO service_role;
GRANT INSERT ON TABLE public.llm_calls TO service_role;
GRANT INSERT ON TABLE public.pending_feedback TO service_role;
GRANT INSERT ON TABLE public.playtest_reports TO service_role;
GRANT INSERT ON TABLE public.quarantined_posts TO service_role;
GRANT INSERT ON TABLE public.run_feedback_snapshots TO service_role;
GRANT INSERT ON TABLE public.run_stage_events TO service_role;
GRANT INSERT ON TABLE public.runs TO service_role;
GRANT INSERT ON TABLE public.seed_sets_public TO service_role;
GRANT INSERT ON TABLE public.specs TO service_role;
GRANT INSERT ON TABLE public.ui_ingest TO anon;
GRANT INSERT ON TABLE public.ui_ingest TO authenticated;
GRANT INSERT ON TABLE public.ui_ingest TO service_role;
GRANT INSERT ON TABLE public.ui_issue_meta TO anon;
GRANT INSERT ON TABLE public.ui_issue_meta TO authenticated;
GRANT INSERT ON TABLE public.ui_issue_meta TO service_role;
GRANT INSERT ON TABLE public.ui_source_status TO anon;
GRANT INSERT ON TABLE public.ui_source_status TO authenticated;
GRANT INSERT ON TABLE public.ui_source_status TO service_role;
GRANT MAINTAIN ON TABLE public.artifacts TO service_role;
GRANT MAINTAIN ON TABLE public.attempts TO anon;
GRANT MAINTAIN ON TABLE public.attempts TO authenticated;
GRANT MAINTAIN ON TABLE public.attempts TO service_role;
GRANT MAINTAIN ON TABLE public.balance_versions TO anon;
GRANT MAINTAIN ON TABLE public.balance_versions TO authenticated;
GRANT MAINTAIN ON TABLE public.balance_versions TO service_role;
GRANT MAINTAIN ON TABLE public.collection_sweeps TO service_role;
GRANT MAINTAIN ON TABLE public.discovered_issue_memberships TO service_role;
GRANT MAINTAIN ON TABLE public.discovered_issues TO service_role;
GRANT MAINTAIN ON TABLE public.discovery_queue TO service_role;
GRANT MAINTAIN ON TABLE public.feedback_posts TO anon;
GRANT MAINTAIN ON TABLE public.feedback_posts TO authenticated;
GRANT MAINTAIN ON TABLE public.feedback_posts TO service_role;
GRANT MAINTAIN ON TABLE public.human_decisions TO service_role;
GRANT MAINTAIN ON TABLE public.issues TO anon;
GRANT MAINTAIN ON TABLE public.issues TO authenticated;
GRANT MAINTAIN ON TABLE public.issues TO service_role;
GRANT MAINTAIN ON TABLE public.llm_calls TO anon;
GRANT MAINTAIN ON TABLE public.llm_calls TO authenticated;
GRANT MAINTAIN ON TABLE public.llm_calls TO service_role;
GRANT MAINTAIN ON TABLE public.pending_feedback TO service_role;
GRANT MAINTAIN ON TABLE public.playtest_reports TO anon;
GRANT MAINTAIN ON TABLE public.playtest_reports TO authenticated;
GRANT MAINTAIN ON TABLE public.playtest_reports TO service_role;
GRANT MAINTAIN ON TABLE public.quarantined_posts TO anon;
GRANT MAINTAIN ON TABLE public.quarantined_posts TO authenticated;
GRANT MAINTAIN ON TABLE public.quarantined_posts TO service_role;
GRANT MAINTAIN ON TABLE public.run_feedback_snapshots TO service_role;
GRANT MAINTAIN ON TABLE public.run_stage_events TO service_role;
GRANT MAINTAIN ON TABLE public.runs TO anon;
GRANT MAINTAIN ON TABLE public.runs TO authenticated;
GRANT MAINTAIN ON TABLE public.runs TO service_role;
GRANT MAINTAIN ON TABLE public.seed_sets_public TO anon;
GRANT MAINTAIN ON TABLE public.seed_sets_public TO authenticated;
GRANT MAINTAIN ON TABLE public.seed_sets_public TO service_role;
GRANT MAINTAIN ON TABLE public.specs TO anon;
GRANT MAINTAIN ON TABLE public.specs TO authenticated;
GRANT MAINTAIN ON TABLE public.specs TO service_role;
GRANT MAINTAIN ON TABLE public.ui_ingest TO anon;
GRANT MAINTAIN ON TABLE public.ui_ingest TO authenticated;
GRANT MAINTAIN ON TABLE public.ui_ingest TO service_role;
GRANT MAINTAIN ON TABLE public.ui_issue_meta TO anon;
GRANT MAINTAIN ON TABLE public.ui_issue_meta TO authenticated;
GRANT MAINTAIN ON TABLE public.ui_issue_meta TO service_role;
GRANT MAINTAIN ON TABLE public.ui_source_status TO anon;
GRANT MAINTAIN ON TABLE public.ui_source_status TO authenticated;
GRANT MAINTAIN ON TABLE public.ui_source_status TO service_role;
GRANT REFERENCES ON TABLE public.artifacts TO service_role;
GRANT REFERENCES ON TABLE public.attempts TO anon;
GRANT REFERENCES ON TABLE public.attempts TO authenticated;
GRANT REFERENCES ON TABLE public.attempts TO service_role;
GRANT REFERENCES ON TABLE public.balance_versions TO anon;
GRANT REFERENCES ON TABLE public.balance_versions TO authenticated;
GRANT REFERENCES ON TABLE public.balance_versions TO service_role;
GRANT REFERENCES ON TABLE public.collection_sweeps TO service_role;
GRANT REFERENCES ON TABLE public.discovered_issue_memberships TO service_role;
GRANT REFERENCES ON TABLE public.discovered_issues TO service_role;
GRANT REFERENCES ON TABLE public.discovery_queue TO service_role;
GRANT REFERENCES ON TABLE public.feedback_posts TO anon;
GRANT REFERENCES ON TABLE public.feedback_posts TO authenticated;
GRANT REFERENCES ON TABLE public.feedback_posts TO service_role;
GRANT REFERENCES ON TABLE public.human_decisions TO service_role;
GRANT REFERENCES ON TABLE public.issues TO anon;
GRANT REFERENCES ON TABLE public.issues TO authenticated;
GRANT REFERENCES ON TABLE public.issues TO service_role;
GRANT REFERENCES ON TABLE public.llm_calls TO anon;
GRANT REFERENCES ON TABLE public.llm_calls TO authenticated;
GRANT REFERENCES ON TABLE public.llm_calls TO service_role;
GRANT REFERENCES ON TABLE public.pending_feedback TO service_role;
GRANT REFERENCES ON TABLE public.playtest_reports TO anon;
GRANT REFERENCES ON TABLE public.playtest_reports TO authenticated;
GRANT REFERENCES ON TABLE public.playtest_reports TO service_role;
GRANT REFERENCES ON TABLE public.quarantined_posts TO anon;
GRANT REFERENCES ON TABLE public.quarantined_posts TO authenticated;
GRANT REFERENCES ON TABLE public.quarantined_posts TO service_role;
GRANT REFERENCES ON TABLE public.run_feedback_snapshots TO service_role;
GRANT REFERENCES ON TABLE public.run_stage_events TO service_role;
GRANT REFERENCES ON TABLE public.runs TO anon;
GRANT REFERENCES ON TABLE public.runs TO authenticated;
GRANT REFERENCES ON TABLE public.runs TO service_role;
GRANT REFERENCES ON TABLE public.seed_sets_public TO anon;
GRANT REFERENCES ON TABLE public.seed_sets_public TO authenticated;
GRANT REFERENCES ON TABLE public.seed_sets_public TO service_role;
GRANT REFERENCES ON TABLE public.specs TO anon;
GRANT REFERENCES ON TABLE public.specs TO authenticated;
GRANT REFERENCES ON TABLE public.specs TO service_role;
GRANT REFERENCES ON TABLE public.ui_ingest TO anon;
GRANT REFERENCES ON TABLE public.ui_ingest TO authenticated;
GRANT REFERENCES ON TABLE public.ui_ingest TO service_role;
GRANT REFERENCES ON TABLE public.ui_issue_meta TO anon;
GRANT REFERENCES ON TABLE public.ui_issue_meta TO authenticated;
GRANT REFERENCES ON TABLE public.ui_issue_meta TO service_role;
GRANT REFERENCES ON TABLE public.ui_source_status TO anon;
GRANT REFERENCES ON TABLE public.ui_source_status TO authenticated;
GRANT REFERENCES ON TABLE public.ui_source_status TO service_role;
GRANT SELECT ON TABLE mockr.posts TO anon;
GRANT SELECT ON TABLE mockr.posts TO authenticated;
GRANT SELECT ON TABLE mockr.posts TO service_role;
GRANT SELECT ON TABLE mockreddit.comments TO anon;
GRANT SELECT ON TABLE mockreddit.comments TO authenticated;
GRANT SELECT ON TABLE mockreddit.comments TO service_role;
GRANT SELECT ON TABLE mockreddit.posts TO anon;
GRANT SELECT ON TABLE mockreddit.posts TO authenticated;
GRANT SELECT ON TABLE mockreddit.posts TO service_role;
GRANT SELECT ON TABLE private.seed_sets TO service_role;
GRANT SELECT ON TABLE public.artifacts TO service_role;
GRANT SELECT ON TABLE public.attempts TO anon;
GRANT SELECT ON TABLE public.attempts TO authenticated;
GRANT SELECT ON TABLE public.attempts TO service_role;
GRANT SELECT ON TABLE public.balance_versions TO anon;
GRANT SELECT ON TABLE public.balance_versions TO authenticated;
GRANT SELECT ON TABLE public.balance_versions TO service_role;
GRANT SELECT ON TABLE public.collection_sweeps TO service_role;
GRANT SELECT ON TABLE public.discovered_issue_memberships TO service_role;
GRANT SELECT ON TABLE public.discovered_issues TO service_role;
GRANT SELECT ON TABLE public.discovery_queue TO service_role;
GRANT SELECT ON TABLE public.feedback_posts TO anon;
GRANT SELECT ON TABLE public.feedback_posts TO authenticated;
GRANT SELECT ON TABLE public.feedback_posts TO service_role;
GRANT SELECT ON TABLE public.human_decisions TO service_role;
GRANT SELECT ON TABLE public.issues TO anon;
GRANT SELECT ON TABLE public.issues TO authenticated;
GRANT SELECT ON TABLE public.issues TO service_role;
GRANT SELECT ON TABLE public.llm_calls TO anon;
GRANT SELECT ON TABLE public.llm_calls TO authenticated;
GRANT SELECT ON TABLE public.llm_calls TO service_role;
GRANT SELECT ON TABLE public.pending_feedback TO service_role;
GRANT SELECT ON TABLE public.playtest_reports TO anon;
GRANT SELECT ON TABLE public.playtest_reports TO authenticated;
GRANT SELECT ON TABLE public.playtest_reports TO service_role;
GRANT SELECT ON TABLE public.quarantined_posts TO anon;
GRANT SELECT ON TABLE public.quarantined_posts TO authenticated;
GRANT SELECT ON TABLE public.quarantined_posts TO service_role;
GRANT SELECT ON TABLE public.run_feedback_snapshots TO service_role;
GRANT SELECT ON TABLE public.run_stage_events TO service_role;
GRANT SELECT ON TABLE public.runs TO anon;
GRANT SELECT ON TABLE public.runs TO authenticated;
GRANT SELECT ON TABLE public.runs TO service_role;
GRANT SELECT ON TABLE public.seed_sets_public TO anon;
GRANT SELECT ON TABLE public.seed_sets_public TO authenticated;
GRANT SELECT ON TABLE public.seed_sets_public TO service_role;
GRANT SELECT ON TABLE public.specs TO anon;
GRANT SELECT ON TABLE public.specs TO authenticated;
GRANT SELECT ON TABLE public.specs TO service_role;
GRANT SELECT ON TABLE public.ui_ingest TO anon;
GRANT SELECT ON TABLE public.ui_ingest TO authenticated;
GRANT SELECT ON TABLE public.ui_ingest TO service_role;
GRANT SELECT ON TABLE public.ui_issue_meta TO anon;
GRANT SELECT ON TABLE public.ui_issue_meta TO authenticated;
GRANT SELECT ON TABLE public.ui_issue_meta TO service_role;
GRANT SELECT ON TABLE public.ui_source_status TO anon;
GRANT SELECT ON TABLE public.ui_source_status TO authenticated;
GRANT SELECT ON TABLE public.ui_source_status TO service_role;
GRANT TRIGGER ON TABLE public.artifacts TO service_role;
GRANT TRIGGER ON TABLE public.attempts TO anon;
GRANT TRIGGER ON TABLE public.attempts TO authenticated;
GRANT TRIGGER ON TABLE public.attempts TO service_role;
GRANT TRIGGER ON TABLE public.balance_versions TO anon;
GRANT TRIGGER ON TABLE public.balance_versions TO authenticated;
GRANT TRIGGER ON TABLE public.balance_versions TO service_role;
GRANT TRIGGER ON TABLE public.collection_sweeps TO service_role;
GRANT TRIGGER ON TABLE public.discovered_issue_memberships TO service_role;
GRANT TRIGGER ON TABLE public.discovered_issues TO service_role;
GRANT TRIGGER ON TABLE public.discovery_queue TO service_role;
GRANT TRIGGER ON TABLE public.feedback_posts TO anon;
GRANT TRIGGER ON TABLE public.feedback_posts TO authenticated;
GRANT TRIGGER ON TABLE public.feedback_posts TO service_role;
GRANT TRIGGER ON TABLE public.human_decisions TO service_role;
GRANT TRIGGER ON TABLE public.issues TO anon;
GRANT TRIGGER ON TABLE public.issues TO authenticated;
GRANT TRIGGER ON TABLE public.issues TO service_role;
GRANT TRIGGER ON TABLE public.llm_calls TO anon;
GRANT TRIGGER ON TABLE public.llm_calls TO authenticated;
GRANT TRIGGER ON TABLE public.llm_calls TO service_role;
GRANT TRIGGER ON TABLE public.pending_feedback TO service_role;
GRANT TRIGGER ON TABLE public.playtest_reports TO anon;
GRANT TRIGGER ON TABLE public.playtest_reports TO authenticated;
GRANT TRIGGER ON TABLE public.playtest_reports TO service_role;
GRANT TRIGGER ON TABLE public.quarantined_posts TO anon;
GRANT TRIGGER ON TABLE public.quarantined_posts TO authenticated;
GRANT TRIGGER ON TABLE public.quarantined_posts TO service_role;
GRANT TRIGGER ON TABLE public.run_feedback_snapshots TO service_role;
GRANT TRIGGER ON TABLE public.run_stage_events TO service_role;
GRANT TRIGGER ON TABLE public.runs TO anon;
GRANT TRIGGER ON TABLE public.runs TO authenticated;
GRANT TRIGGER ON TABLE public.runs TO service_role;
GRANT TRIGGER ON TABLE public.seed_sets_public TO anon;
GRANT TRIGGER ON TABLE public.seed_sets_public TO authenticated;
GRANT TRIGGER ON TABLE public.seed_sets_public TO service_role;
GRANT TRIGGER ON TABLE public.specs TO anon;
GRANT TRIGGER ON TABLE public.specs TO authenticated;
GRANT TRIGGER ON TABLE public.specs TO service_role;
GRANT TRIGGER ON TABLE public.ui_ingest TO anon;
GRANT TRIGGER ON TABLE public.ui_ingest TO authenticated;
GRANT TRIGGER ON TABLE public.ui_ingest TO service_role;
GRANT TRIGGER ON TABLE public.ui_issue_meta TO anon;
GRANT TRIGGER ON TABLE public.ui_issue_meta TO authenticated;
GRANT TRIGGER ON TABLE public.ui_issue_meta TO service_role;
GRANT TRIGGER ON TABLE public.ui_source_status TO anon;
GRANT TRIGGER ON TABLE public.ui_source_status TO authenticated;
GRANT TRIGGER ON TABLE public.ui_source_status TO service_role;
GRANT TRUNCATE ON TABLE public.artifacts TO service_role;
GRANT TRUNCATE ON TABLE public.attempts TO service_role;
GRANT TRUNCATE ON TABLE public.balance_versions TO service_role;
GRANT TRUNCATE ON TABLE public.collection_sweeps TO service_role;
GRANT TRUNCATE ON TABLE public.discovered_issue_memberships TO service_role;
GRANT TRUNCATE ON TABLE public.discovered_issues TO service_role;
GRANT TRUNCATE ON TABLE public.discovery_queue TO service_role;
GRANT TRUNCATE ON TABLE public.feedback_posts TO service_role;
GRANT TRUNCATE ON TABLE public.human_decisions TO service_role;
GRANT TRUNCATE ON TABLE public.issues TO service_role;
GRANT TRUNCATE ON TABLE public.llm_calls TO service_role;
GRANT TRUNCATE ON TABLE public.pending_feedback TO service_role;
GRANT TRUNCATE ON TABLE public.playtest_reports TO service_role;
GRANT TRUNCATE ON TABLE public.quarantined_posts TO service_role;
GRANT TRUNCATE ON TABLE public.run_feedback_snapshots TO service_role;
GRANT TRUNCATE ON TABLE public.run_stage_events TO service_role;
GRANT TRUNCATE ON TABLE public.runs TO service_role;
GRANT TRUNCATE ON TABLE public.seed_sets_public TO service_role;
GRANT TRUNCATE ON TABLE public.specs TO service_role;
GRANT TRUNCATE ON TABLE public.ui_ingest TO anon;
GRANT TRUNCATE ON TABLE public.ui_ingest TO authenticated;
GRANT TRUNCATE ON TABLE public.ui_ingest TO service_role;
GRANT TRUNCATE ON TABLE public.ui_issue_meta TO anon;
GRANT TRUNCATE ON TABLE public.ui_issue_meta TO authenticated;
GRANT TRUNCATE ON TABLE public.ui_issue_meta TO service_role;
GRANT TRUNCATE ON TABLE public.ui_source_status TO anon;
GRANT TRUNCATE ON TABLE public.ui_source_status TO authenticated;
GRANT TRUNCATE ON TABLE public.ui_source_status TO service_role;
GRANT UPDATE ON TABLE mockr.posts TO service_role;
GRANT UPDATE ON TABLE mockreddit.comments TO service_role;
GRANT UPDATE ON TABLE mockreddit.posts TO service_role;
GRANT UPDATE ON TABLE public.artifacts TO service_role;
GRANT UPDATE ON TABLE public.attempts TO service_role;
GRANT UPDATE ON TABLE public.balance_versions TO service_role;
GRANT UPDATE ON TABLE public.collection_sweeps TO service_role;
GRANT UPDATE ON TABLE public.discovered_issue_memberships TO service_role;
GRANT UPDATE ON TABLE public.discovered_issues TO service_role;
GRANT UPDATE ON TABLE public.discovery_queue TO service_role;
GRANT UPDATE ON TABLE public.feedback_posts TO service_role;
GRANT UPDATE ON TABLE public.human_decisions TO service_role;
GRANT UPDATE ON TABLE public.issues TO service_role;
GRANT UPDATE ON TABLE public.llm_calls TO service_role;
GRANT UPDATE ON TABLE public.pending_feedback TO service_role;
GRANT UPDATE ON TABLE public.playtest_reports TO service_role;
GRANT UPDATE ON TABLE public.quarantined_posts TO service_role;
GRANT UPDATE ON TABLE public.run_feedback_snapshots TO service_role;
GRANT UPDATE ON TABLE public.run_stage_events TO service_role;
GRANT UPDATE ON TABLE public.runs TO service_role;
GRANT UPDATE ON TABLE public.seed_sets_public TO service_role;
GRANT UPDATE ON TABLE public.specs TO service_role;
GRANT UPDATE ON TABLE public.ui_ingest TO anon;
GRANT UPDATE ON TABLE public.ui_ingest TO authenticated;
GRANT UPDATE ON TABLE public.ui_ingest TO service_role;
GRANT UPDATE ON TABLE public.ui_issue_meta TO anon;
GRANT UPDATE ON TABLE public.ui_issue_meta TO authenticated;
GRANT UPDATE ON TABLE public.ui_issue_meta TO service_role;
GRANT UPDATE ON TABLE public.ui_source_status TO anon;
GRANT UPDATE ON TABLE public.ui_source_status TO authenticated;
GRANT UPDATE ON TABLE public.ui_source_status TO service_role;
GRANT SELECT ON SEQUENCE public.attempts_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.balance_versions_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.llm_calls_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.playtest_reports_id_seq TO service_role;
GRANT SELECT ON SEQUENCE public.run_stage_events_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.attempts_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.balance_versions_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.llm_calls_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.playtest_reports_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.run_stage_events_id_seq TO service_role;
GRANT EXECUTE ON FUNCTION mockr."like"(text, integer) TO anon;
GRANT EXECUTE ON FUNCTION mockr."like"(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION mockr."like"(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION mockr.repost(text, integer) TO anon;
GRANT EXECUTE ON FUNCTION mockr.repost(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION mockr.repost(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION mockr.search_recent(text, integer, text) TO anon;
GRANT EXECUTE ON FUNCTION mockr.search_recent(text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION mockr.search_recent(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION mockr.submit_post(text, text) TO anon;
GRANT EXECUTE ON FUNCTION mockr.submit_post(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION mockr.submit_post(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION mockreddit.listing(text, integer, text) TO anon;
GRANT EXECUTE ON FUNCTION mockreddit.listing(text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION mockreddit.listing(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION mockreddit.submit_comment(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION mockreddit.submit_comment(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION mockreddit.submit_comment(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION mockreddit.submit_post(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION mockreddit.submit_post(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION mockreddit.submit_post(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION mockreddit.vote(text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION mockreddit.vote(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION mockreddit.vote(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_run(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_holdout_seeds() TO service_role;
GRANT EXECUTE ON FUNCTION public.start_selected_run(uuid, text, text, jsonb) TO service_role;

-- Supabase supplies this publication; application table membership is captured here.
ALTER PUBLICATION supabase_realtime ADD TABLE mockr.posts, mockreddit.comments, mockreddit.posts, public.attempts, public.issues, public.playtest_reports, public.quarantined_posts, public.runs, public.specs;

COMMIT;
