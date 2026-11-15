-- Durable numeric Hexlab experiments and append-only workflow history.
-- Forward-only; operator applies after inspecting the deployed schema/history.
ALTER TABLE public.runs
  ADD COLUMN experiment_kind text NOT NULL DEFAULT 'source_code'
    CHECK (experiment_kind IN ('source_code', 'hexlab_numeric')),
  ADD COLUMN lifecycle_phase text NOT NULL DEFAULT 'legacy',
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN baseline_config_id text,
  ADD COLUMN baseline_config jsonb CHECK (baseline_config IS NULL OR jsonb_typeof(baseline_config) = 'object'),
  ADD COLUMN engine_id text,
  ADD COLUMN current_spec_version_id uuid,
  ADD COLUMN approved_spec_version_id uuid,
  ADD COLUMN simulation_generation integer NOT NULL DEFAULT 0 CHECK (simulation_generation >= 0);
CREATE INDEX runs_lifecycle_active_idx ON public.runs(lifecycle_phase, created_at DESC)
  WHERE experiment_kind = 'hexlab_numeric';

CREATE TABLE public.spec_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  parent_version_id uuid,
  author_kind text NOT NULL CHECK (author_kind IN ('ai', 'human')),
  author text NOT NULL CHECK (char_length(btrim(author)) BETWEEN 1 AND 100),
  markdown text NOT NULL CHECK (char_length(markdown) <= 50000),
  structured_spec jsonb NOT NULL CHECK (jsonb_typeof(structured_spec) = 'object'),
  numeric_patch jsonb NOT NULL CHECK (jsonb_typeof(numeric_patch) = 'array'),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  prompt text CHECK (prompt IS NULL OR char_length(prompt) <= 5000),
  model_output jsonb,
  model_call_id bigint REFERENCES public.llm_calls(id) ON DELETE SET NULL,
  design_artifact_id uuid REFERENCES public.artifacts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, version_number),
  UNIQUE (run_id, id),
  FOREIGN KEY (run_id,parent_version_id) REFERENCES public.spec_versions(run_id,id) ON DELETE RESTRICT
);
CREATE INDEX spec_versions_run_idx ON public.spec_versions(run_id, version_number DESC);

ALTER TABLE public.runs
  ADD CONSTRAINT runs_current_spec_version_fk FOREIGN KEY (id,current_spec_version_id)
    REFERENCES public.spec_versions(run_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT runs_approved_spec_version_fk FOREIGN KEY (id,approved_spec_version_id)
    REFERENCES public.spec_versions(run_id,id) ON DELETE RESTRICT;

CREATE TABLE public.spec_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE RESTRICT,
  spec_version_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('approved', 'invalidated')),
  baseline_config_id text NOT NULL,
  baseline_config jsonb NOT NULL CHECK (jsonb_typeof(baseline_config) = 'object'),
  engine_id text NOT NULL,
  numeric_patch jsonb NOT NULL CHECK (jsonb_typeof(numeric_patch) = 'array'),
  seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  mode text NOT NULL CHECK (mode IN ('pvp', 'pve')),
  battles integer NOT NULL CHECK (battles IN (100, 1000, 5000, 10000)),
  actor text NOT NULL CHECK (char_length(btrim(actor)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  FOREIGN KEY (run_id,spec_version_id) REFERENCES public.spec_versions(run_id,id) ON DELETE RESTRICT,
  UNIQUE (run_id,id)
);
CREATE UNIQUE INDEX spec_approvals_one_current_idx ON public.spec_approvals(run_id)
  WHERE state = 'approved';

CREATE TABLE public.workflow_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('spec_initial', 'spec_revision', 'simulation')),
  state text NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'interrupted', 'retired')),
  generation integer NOT NULL CHECK (generation >= 0),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  max_attempts integer NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 3),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  claimed_by text,
  last_retry_key text,
  last_retry_hash text,
  UNIQUE (run_id,kind,idempotency_key)
);
CREATE INDEX workflow_jobs_claim_idx ON public.workflow_jobs(created_at,id)
  WHERE state = 'queued';
CREATE INDEX workflow_jobs_run_idx ON public.workflow_jobs(run_id,created_at DESC);

CREATE TABLE public.hexlab_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE RESTRICT,
  spec_version_id uuid NOT NULL,
  approval_id uuid NOT NULL,
  job_id uuid NOT NULL UNIQUE REFERENCES public.workflow_jobs(id) ON DELETE RESTRICT,
  generation integer NOT NULL CHECK (generation >= 0),
  state text NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'interrupted', 'retired')),
  baseline_config_id text NOT NULL,
  engine_id text NOT NULL,
  numeric_patch jsonb NOT NULL CHECK (jsonb_typeof(numeric_patch) = 'array'),
  seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  mode text NOT NULL CHECK (mode IN ('pvp', 'pve')),
  battles integer NOT NULL CHECK (battles IN (100, 1000, 5000, 10000)),
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (run_id,id),
  FOREIGN KEY (run_id,spec_version_id) REFERENCES public.spec_versions(run_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id,approval_id) REFERENCES public.spec_approvals(run_id,id) ON DELETE RESTRICT
);
CREATE INDEX hexlab_simulations_run_idx ON public.hexlab_simulations(run_id,created_at DESC);

ALTER TABLE public.human_decisions
  ALTER COLUMN candidate_revision DROP NOT NULL,
  ADD COLUMN spec_version_id uuid,
  ADD COLUMN simulation_id uuid,
  ADD COLUMN candidate_identity text CHECK (candidate_identity IS NULL OR candidate_identity ~ '^[a-f0-9]{64}$');
ALTER TABLE public.human_decisions
  ADD CONSTRAINT human_decisions_spec_version_fk FOREIGN KEY (run_id,spec_version_id)
    REFERENCES public.spec_versions(run_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT human_decisions_simulation_fk FOREIGN KEY (run_id,simulation_id)
    REFERENCES public.hexlab_simulations(run_id,id) ON DELETE RESTRICT;

ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spec_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spec_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hexlab_simulations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.spec_versions, public.spec_approvals, public.workflow_jobs, public.hexlab_simulations FROM anon, authenticated;
GRANT SELECT, INSERT ON public.spec_versions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spec_approvals, public.workflow_jobs, public.hexlab_simulations TO service_role;
