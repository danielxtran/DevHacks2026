-- Durable issue triage and collaboration. Do not apply automatically at startup.
ALTER TABLE public.discovered_issues
  ADD COLUMN triage_state text NOT NULL DEFAULT 'open'
    CHECK (triage_state IN ('open', 'dismissed', 'merged')),
  ADD COLUMN assigned_developer text
    CHECK (assigned_developer IS NULL OR assigned_developer IN ('dev', 'jun', 'marco', 'ana', 'priya')),
  ADD COLUMN human_title text CHECK (human_title IS NULL OR char_length(human_title) BETWEEN 1 AND 200),
  ADD COLUMN human_tags text[] CHECK (human_tags IS NULL OR cardinality(human_tags) <= 20),
  ADD COLUMN canonical_issue_id uuid REFERENCES public.discovered_issues(id) ON DELETE RESTRICT,
  ADD COLUMN dismissed_by text,
  ADD COLUMN dismissed_reason text,
  ADD COLUMN dismissed_at timestamptz,
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD CONSTRAINT discovered_issues_not_self_merged CHECK (canonical_issue_id IS NULL OR canonical_issue_id <> id),
  ADD CONSTRAINT discovered_issues_triage_shape CHECK (
    (triage_state = 'merged') = (canonical_issue_id IS NOT NULL)
  );
CREATE INDEX discovered_issues_triage_updated_idx ON public.discovered_issues(triage_state, updated_at DESC);
CREATE INDEX discovered_issues_canonical_idx ON public.discovered_issues(canonical_issue_id) WHERE canonical_issue_id IS NOT NULL;

CREATE TABLE public.issue_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.discovered_issues(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('metadata_updated', 'comment', 'dismissed', 'restored', 'merged', 'experiment_started', 'experiment_finalized', 'spec_version_saved', 'spec_rejected', 'returned_to_development')),
  actor text NOT NULL CHECK (char_length(btrim(actor)) BETWEEN 1 AND 100),
  body text CHECK (body IS NULL OR char_length(body) <= 5000),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX issue_activity_issue_created_idx ON public.issue_activity(issue_id, created_at, id);

ALTER TABLE public.issue_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.issue_activity FROM anon, authenticated;
GRANT SELECT, INSERT ON public.issue_activity TO service_role;
