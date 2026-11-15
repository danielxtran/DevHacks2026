import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { ArtifactStore } from './artifact-store.js';
import { HumanDecisionSchema, IssueCommentRequestSchema, IssueDismissRequestSchema, IssueMergeRequestSchema,
  IssueMetadataRequestSchema, IssueRestoreRequestSchema, NumericDecisionRequestSchema, ReturnToDevelopmentRequestSchema,
  RunStatusSchema, SimulationQueueRequestSchema, SimulationRetryRequestSchema, SpecApprovalRequestSchema,
  SpecEditRequestSchema, SpecRejectionRequestSchema, SpecRevisionRequestSchema, StartRunRequestSchema } from './contracts.js';
import { validateHexlabConfig } from './hexlab.js';
import { addIssueComment, ConflictError, dismissIssue, mergeIssues, NotFoundError, recordDecision, restoreIssue,
  approveNumericSpec, queueSimulationRerun, queueSpecRevision, recordNumericDecision, rejectNumericSpec,
  resumeRun, returnNumericExperimentToDevelopment, retryHexlabSimulation, saveSpecVersion, startNumericExperiment,
  updateIssueMetadata } from './repository.js';

const uuid = z.string().uuid();

export interface ApiOptions {
  pool: Pool;
  artifacts: ArtifactStore;
  baselineRevision: string | undefined;
  scenarios: unknown[];
  sourceConfigured: boolean;
  discoveryConfigured: boolean;
  modelConfigured?: boolean;
  getHexlabConfig?: () => Promise<unknown>;
  sourceRetryEnabled?: boolean;
}

export function createApp(options: ApiOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb', strict: true }));
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  app.get('/health', async (_req, res, next) => {
    try {
      await options.pool.query('select 1');
      res.json({ status: 'ok', database: 'connected', sources: options.sourceConfigured, discovery: options.discoveryConfigured,
        workflow: Boolean(options.getHexlabConfig) });
    } catch (error) { next(error); }
  });

  app.get('/capabilities', (_req, res) => {
    res.json({ capabilities: {
      issueMetadata: { enabled: true }, discussion: { enabled: true }, triage: { enabled: true }, merge: { enabled: true },
      startExperiment: { enabled: Boolean(options.getHexlabConfig && options.modelConfigured), reason: !options.modelConfigured ? 'Set OPENAI_API_KEY and OPENAI_MODEL on the backend.' : options.getHexlabConfig ? null : 'Configure the loopback Hexlab API before starting experiments.' },
      specWriter: { enabled: Boolean(options.modelConfigured), reason: options.modelConfigured ? null : 'Set OPENAI_API_KEY and OPENAI_MODEL on the backend.' },
      simulation: { enabled: Boolean(options.getHexlabConfig), reason: options.getHexlabConfig ? null : 'Configure the loopback Hexlab API before approving a patch.' },
      sourceRetry: { enabled: Boolean(options.sourceRetryEnabled), reason: options.sourceRetryEnabled ? null : 'Collection runs on its paced backend schedule; manual retry is unavailable.' },
      deployment: { enabled: false, reason: 'Deployment is not implemented for this workflow.' },
    } });
  });

  app.get('/sources', async (_req, res, next) => {
    try {
      const result = await options.pool.query(
        `select distinct on (source) source, status, pages, items, truncated, error,
           started_at::text as started_at, completed_at::text as completed_at
         from public.collection_sweeps order by source, started_at desc, id desc`,
      );
      res.json({ sources: result.rows });
    } catch (error) { next(error); }
  });

  app.get('/issues', async (_req, res, next) => {
    try {
      const result = await options.pool.query(
        `select i.id, coalesce(i.human_title,i.title) as title, i.title as discovery_title,
           i.summary, i.category::text as category, i.target, i.target_type,
           coalesce(i.human_tags,i.tags) as tags, i.human_title, i.human_tags,
           i.assigned_developer, i.triage_state, i.canonical_issue_id, i.revision,
           i.dismissed_by, i.dismissed_reason, i.dismissed_at::text as dismissed_at,
           i.first_seen_at::text as first_seen_at, i.last_seen_at::text as last_seen_at,
           count(distinct m.feedback_id)::integer as feedback_count,
           jsonb_build_object('reddit', count(distinct f.id) filter (where f.source='reddit'),
             'r', count(distinct f.id) filter (where f.source='r')) as source_counts,
           max(f.posted_at)::text as last_feedback_at, latest.latest_run
         from public.discovered_issues i
         left join public.discovered_issue_memberships m on m.issue_id=i.id
         left join public.feedback_posts f on f.id=m.feedback_id
         left join lateral (
           select jsonb_build_object('id', r.id, 'status', r.status, 'stage', r.workflow_stage,
             'phase', r.lifecycle_phase, 'kind', r.experiment_kind, 'revision', r.revision,
             'currentSpecVersionId', r.current_spec_version_id, 'approvedSpecVersionId', r.approved_spec_version_id,
             'error', r.error, 'attempt', r.current_attempt, 'decision', d.decision,
             'reviewer', d.reviewer, 'decidedAt', d.created_at, 'createdAt', r.created_at) as latest_run
           from public.runs r left join public.human_decisions d on d.run_id=r.id
           where r.selected_issue_id=i.id order by r.created_at desc, r.id desc limit 1
         ) latest on true
         where i.status='active'
         group by i.id, latest.latest_run order by i.updated_at desc, i.id`,
      );
      res.json({ issues: result.rows });
    } catch (error) { next(error); }
  });

  app.get('/issues/:issueId', async (req, res, next) => {
    try {
      const issueId = uuid.parse(req.params.issueId);
      const result = await options.pool.query(
        `select i.id, coalesce(i.human_title,i.title) as title, i.title as discovery_title,
           i.summary, i.category::text as category, i.target, i.target_type,
           coalesce(i.human_tags,i.tags) as tags, i.human_title, i.human_tags,
           i.assigned_developer, i.triage_state, i.canonical_issue_id, i.revision,
           i.dismissed_by, i.dismissed_reason, i.dismissed_at::text as dismissed_at,
           i.first_seen_at::text as first_seen_at, i.last_seen_at::text as last_seen_at,
           coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'source', f.source, 'externalId', f.external_id,
             'kind', f.kind, 'title', f.title, 'body', f.body, 'author', f.author, 'score', f.score,
             'postedAt', f.posted_at, 'sourceUrl', f.source_url, 'parentId', f.parent_id, 'threadId', f.thread_id,
             'numComments', f.num_comments) order by f.posted_at, f.id)
             filter (where f.id is not null), '[]'::jsonb) as feedback,
           coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'type',a.event_type,'actor',a.actor,
             'text',a.body,'details',a.details,'createdAt',a.created_at) order by a.created_at,a.id)
             from public.issue_activity a where a.issue_id=i.id), '[]'::jsonb) as activity
         from public.discovered_issues i
         left join public.discovered_issue_memberships m on m.issue_id=i.id
         left join public.feedback_posts f on f.id=m.feedback_id
         where i.id=$1 and i.status='active'
         group by i.id`, [issueId],
      );
      if (!result.rowCount) throw new NotFoundError('issue_not_found');
      res.json({ issue: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.get('/issues/:issueId/runs', async (req, res, next) => {
    try {
      const issueId = uuid.parse(req.params.issueId);
      const result = await options.pool.query(
        `select r.id,r.status::text as status,r.workflow_stage as stage,r.lifecycle_phase as phase,
            r.experiment_kind as kind,r.revision,r.error,r.current_spec_version_id,r.approved_spec_version_id,
            r.simulation_generation,r.created_at::text as created_at,d.decision,d.reviewer,d.created_at::text as decided_at
         from public.runs r left join public.human_decisions d on d.run_id=r.id
         where r.selected_issue_id=$1 order by r.created_at desc,r.id desc`, [issueId],
      );
      res.json({ runs: result.rows });
    } catch (error) { next(error); }
  });

  app.patch('/issues/:issueId', async (req, res, next) => {
    try {
      const issueId = uuid.parse(req.params.issueId);
      const change = IssueMetadataRequestSchema.parse(req.body);
      const issue = await updateIssueMetadata(options.pool, issueId, change);
      res.json({ issue });
    } catch (error) { next(error); }
  });

  app.post('/issues/:issueId/comments', async (req, res, next) => {
    try {
      const issueId = uuid.parse(req.params.issueId);
      const command = IssueCommentRequestSchema.parse(req.body);
      const comment = await addIssueComment(options.pool, issueId, command);
      res.status(201).json({ comment });
    } catch (error) { next(error); }
  });

  app.post('/issues/:issueId/dismiss', async (req, res, next) => {
    try {
      const issueId = uuid.parse(req.params.issueId);
      await dismissIssue(options.pool, issueId, IssueDismissRequestSchema.parse(req.body));
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.post('/issues/:issueId/restore', async (req, res, next) => {
    try {
      const issueId = uuid.parse(req.params.issueId);
      await restoreIssue(options.pool, issueId, IssueRestoreRequestSchema.parse(req.body));
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.post('/issues/:issueId/merge', async (req, res, next) => {
    try {
      const issueId = uuid.parse(req.params.issueId);
      const command = IssueMergeRequestSchema.parse(req.body);
      const result = await mergeIssues(options.pool, issueId, command);
      res.json({ issue: result });
    } catch (error) { next(error); }
  });

  app.post('/issues/:issueId/runs', async (req, res, next) => {
    try {
      const issueId = uuid.parse(req.params.issueId);
      const body = StartRunRequestSchema.parse(req.body);
      if (!options.modelConfigured) {
        res.status(503).json({ error: 'spec_writer_not_configured', detail: 'Set OPENAI_API_KEY and OPENAI_MODEL on the backend.' });
        return;
      }
      if (!options.getHexlabConfig) {
        res.status(503).json({ error: 'hexlab_not_configured', detail: 'Configure the loopback Hexlab API before starting experiments.' });
        return;
      }
      let baseline: ReturnType<typeof validateHexlabConfig>;
      try { baseline = validateHexlabConfig(await options.getHexlabConfig()); }
      catch (error) {
        res.status(503).json({ error: 'hexlab_unavailable', detail: error instanceof Error ? error.message : String(error) });
        return;
      }
      const { baselineConfigId, engineId, ...config } = baseline;
      const id = await startNumericExperiment(options.pool, issueId, body, { baselineConfigId, engineId, config });
      const run = await options.pool.query(
        `select id, status::text as status, workflow_stage, error, baseline_revision, candidate_revision,
                to_json(created_at) as created_at
         from public.runs where id=$1`, [id],
      );
      res.status(202).json({ run: RunStatusSchema.parse(run.rows[0]) });
    } catch (error) { next(error); }
  });

  app.get('/runs/:runId', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      const result = await options.pool.query(
        `select r.id, r.status::text as status, r.workflow_stage, r.lifecycle_phase, r.experiment_kind,
                r.revision, r.error, r.baseline_revision, r.candidate_revision, r.baseline_config_id,
                r.engine_id, r.current_spec_version_id, r.approved_spec_version_id, r.simulation_generation,
                to_json(r.created_at) as created_at, r.started_at::text as started_at, r.finished_at::text as finished_at,
                r.current_attempt,
                (select jsonb_agg(jsonb_build_object('stage',e.stage,'status',e.status,'error',e.error,
                   'startedAt',e.started_at,'completedAt',e.completed_at) order by e.id)
                 from public.run_stage_events e where e.run_id=r.id) as stages,
                (select row_to_json(d) from (select decision, reviewer, comment, candidate_revision,
                   spec_version_id,simulation_id,candidate_identity,created_at::text as created_at
                   from public.human_decisions where run_id=r.id) d) as decision
         from public.runs r where r.id=$1`, [runId],
      );
      if (!result.rowCount) throw new NotFoundError('run_not_found');
      const { stages, decision, ...run } = result.rows[0]!;
      res.json({ run: RunStatusSchema.parse(run), stages: stages ?? [], decision: decision ?? null,
        capabilities: {
          editSpec: { enabled: run.experiment_kind === 'hexlab_numeric' && run.lifecycle_phase === 'spec_review', reason: run.lifecycle_phase === 'spec_review' ? null : 'The experiment is not in spec review.' },
          approveSpec: { enabled: Boolean(options.getHexlabConfig && run.lifecycle_phase === 'spec_review'), reason: !options.getHexlabConfig ? 'Hexlab is not configured.' : run.lifecycle_phase === 'spec_review' ? null : 'The experiment is not in spec review.' },
          simulation: { enabled: Boolean(options.getHexlabConfig), reason: options.getHexlabConfig ? null : 'Hexlab is not configured.' },
        } });
    } catch (error) { next(error); }
  });

  app.get('/runs/:runId/specs', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      const result = await options.pool.query(
        `select s.id,s.version_number,s.parent_version_id,s.author_kind,s.author,s.markdown,s.structured_spec,
            s.numeric_patch,s.note,s.created_at::text as created_at,s.design_artifact_id,
            (s.id=r.current_spec_version_id) as current,(s.id=r.approved_spec_version_id) as approved
         from public.spec_versions s join public.runs r on r.id=s.run_id
         where s.run_id=$1 order by s.version_number`, [runId],
      );
      const jobs = await options.pool.query(
        `select id,kind,state,input->>'prompt' as prompt,result,error,attempt,created_at::text as created_at,
            completed_at::text as completed_at
         from public.workflow_jobs where run_id=$1 and kind in ('spec_initial','spec_revision') order by created_at,id`, [runId],
      );
      res.json({ versions: result.rows, jobs: jobs.rows });
    } catch (error) { next(error); }
  });

  app.get('/runs/:runId/simulations', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      const result = await options.pool.query(
        `select s.id,s.spec_version_id,s.approval_id,s.job_id,s.generation,s.state,s.baseline_config_id,s.engine_id,
            s.numeric_patch,s.seed,s.mode,s.battles,s.result,s.error,s.created_at::text as created_at,
            s.started_at::text as started_at,s.completed_at::text as completed_at,j.attempt,j.max_attempts,
            a.baseline_config
         from public.hexlab_simulations s join public.workflow_jobs j on j.id=s.job_id
         join public.spec_approvals a on a.id=s.approval_id where s.run_id=$1
         order by s.created_at,s.id`, [runId],
      );
      res.json({ simulations: result.rows });
    } catch (error) { next(error); }
  });

  app.get('/runs/:runId/artifacts', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      const exists = await options.pool.query('select 1 from public.runs where id=$1', [runId]);
      if (!exists.rowCount) throw new NotFoundError('run_not_found');
      res.json({ artifacts: await options.artifacts.list(runId) });
    } catch (error) { next(error); }
  });

  app.get('/artifacts/:artifactId', async (req, res, next) => {
    try {
      const artifactId = uuid.parse(req.params.artifactId);
      const artifact = await options.artifacts.read(artifactId);
      const metadata = artifact.meta as { media_type: string };
      res.type(metadata.media_type).send(artifact.contents);
    } catch (error) {
      if (error instanceof Error && error.message === 'artifact_not_found') error = new NotFoundError('artifact_not_found');
      next(error);
    }
  });

  app.post('/runs/:runId/spec-revisions', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      const job = await queueSpecRevision(options.pool, runId, SpecRevisionRequestSchema.parse(req.body));
      res.status(202).json({ runId, jobId: job.jobId, status: 'queued' });
    } catch (error) { next(error); }
  });

  app.patch('/runs/:runId/specs', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      const version = await saveSpecVersion(options.pool, runId, SpecEditRequestSchema.parse(req.body));
      res.status(201).json({ runId, version });
    } catch (error) { next(error); }
  });

  app.post('/runs/:runId/spec-approval', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      const result = await approveNumericSpec(options.pool, runId, SpecApprovalRequestSchema.parse(req.body));
      res.status(202).json({ runId, ...result, status: 'queued' });
    } catch (error) { next(error); }
  });

  app.post('/runs/:runId/spec-rejection', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      await rejectNumericSpec(options.pool, runId, SpecRejectionRequestSchema.parse(req.body));
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.post('/runs/:runId/simulations', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      const result = await queueSimulationRerun(options.pool, runId, SimulationQueueRequestSchema.parse(req.body));
      res.status(202).json({ runId, ...result, status: 'queued' });
    } catch (error) { next(error); }
  });

  app.post('/runs/:runId/simulations/:simulationId/retry', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      const simulationId = uuid.parse(req.params.simulationId);
      await retryHexlabSimulation(options.pool, runId, simulationId, SimulationRetryRequestSchema.parse(req.body));
      res.status(202).json({ runId, simulationId, status: 'queued' });
    } catch (error) { next(error); }
  });

  app.post('/runs/:runId/return-to-development', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      await returnNumericExperimentToDevelopment(options.pool, runId, ReturnToDevelopmentRequestSchema.parse(req.body));
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.post('/runs/:runId/resume', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      await resumeRun(options.pool, runId);
      res.status(202).json({ runId, status: 'queued', stage: 'resume_requested' });
    } catch (error) { next(error); }
  });

  app.post('/runs/:runId/decision', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      if (req.body && typeof req.body === 'object' && 'specVersionId' in req.body) {
        const decision = NumericDecisionRequestSchema.parse(req.body);
        const saved = await recordNumericDecision(options.pool, runId, decision);
        res.status(201).json({ runId, ...saved });
      } else {
        const decision = HumanDecisionSchema.parse(req.body);
        await recordDecision(options.pool, runId, decision);
        res.status(201).json({ runId, decision: decision.decision, candidateRevision: decision.candidateRevision });
      }
    } catch (error) { next(error); }
  });

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'invalid_request', details: error.issues.map(({ path, message }) => ({ path, message })) });
      return;
    }
    if (error instanceof NotFoundError) { res.status(404).json({ error: error.message }); return; }
    if (error instanceof ConflictError) { res.status(409).json({ error: error.message }); return; }
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      const message = String(error.message);
      if (message === 'issue_not_found') { res.status(404).json({ error: message }); return; }
      if (['idempotency_conflict', 'active_run_exists'].includes(message)) { res.status(409).json({ error: message }); return; }
      if (message === 'exactly_three_scenarios_required' || message.startsWith('invalid_')) {
        res.status(400).json({ error: message }); return;
      }
    }
    console.error('Request failed:', error);
    res.status(500).json({ error: 'internal_error' });
  };
  app.use(errors);
  return app;
}
