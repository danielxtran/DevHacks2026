import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { ArtifactStore } from './artifact-store.js';
import { HumanDecisionSchema, RunStatusSchema, StartRunRequestSchema } from './contracts.js';
import { ConflictError, NotFoundError, recordDecision, resumeRun, startSelectedRun } from './repository.js';

const uuid = z.string().uuid();

export interface ApiOptions {
  pool: Pool;
  artifacts: ArtifactStore;
  baselineRevision: string | undefined;
  scenarios: unknown[];
  sourceConfigured: boolean;
  discoveryConfigured: boolean;
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
        workflow: Boolean(options.baselineRevision && options.scenarios.length === 3) });
    } catch (error) { next(error); }
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
        `select i.id, i.title, i.summary, i.category::text as category, i.target, i.target_type,
           i.tags, i.first_seen_at::text as first_seen_at, i.last_seen_at::text as last_seen_at,
           count(m.feedback_id)::integer as feedback_count,
           jsonb_build_object('reddit', count(*) filter (where f.source='reddit'),
             'r', count(*) filter (where f.source='r')) as source_counts,
           max(f.posted_at)::text as last_feedback_at, latest.latest_run
         from public.discovered_issues i
         left join public.discovered_issue_memberships m on m.issue_id=i.id
         left join public.feedback_posts f on f.id=m.feedback_id
         left join lateral (
           select jsonb_build_object('id', r.id, 'status', r.status, 'stage', r.workflow_stage,
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
        `select i.id, i.title, i.summary, i.category::text as category, i.target, i.target_type,
           i.tags, i.first_seen_at::text as first_seen_at, i.last_seen_at::text as last_seen_at,
           coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'source', f.source, 'externalId', f.external_id,
             'kind', f.kind, 'title', f.title, 'body', f.body, 'author', f.author, 'score', f.score,
             'postedAt', f.posted_at, 'sourceUrl', f.source_url, 'parentId', f.parent_id, 'threadId', f.thread_id,
             'numComments', f.num_comments) order by f.posted_at, f.id)
             filter (where f.id is not null), '[]'::jsonb) as feedback
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

  app.post('/issues/:issueId/runs', async (req, res, next) => {
    try {
      const issueId = uuid.parse(req.params.issueId);
      const body = StartRunRequestSchema.parse(req.body);
      if (!options.baselineRevision || options.scenarios.length !== 3) {
        res.status(503).json({ error: 'workflow_not_configured', detail: 'Set BASELINE_REVISION and exactly three scenarios before starting runs.' });
        return;
      }
      const id = await startSelectedRun(options.pool, issueId, body, options.baselineRevision, options.scenarios);
      const run = await options.pool.query(
        `select id, status::text as status, workflow_stage, error, baseline_revision, candidate_revision,
                created_at::text as created_at
         from public.runs where id=$1`, [id],
      );
      res.status(202).json({ run: RunStatusSchema.parse(run.rows[0]) });
    } catch (error) { next(error); }
  });

  app.get('/runs/:runId', async (req, res, next) => {
    try {
      const runId = uuid.parse(req.params.runId);
      const result = await options.pool.query(
        `select r.id, r.status::text as status, r.workflow_stage, r.error, r.baseline_revision,
                r.candidate_revision, r.created_at::text as created_at, r.started_at::text as started_at,
                r.finished_at::text as finished_at, r.current_attempt,
                (select jsonb_agg(jsonb_build_object('stage',e.stage,'status',e.status,'error',e.error,
                   'startedAt',e.started_at,'completedAt',e.completed_at) order by e.id)
                 from public.run_stage_events e where e.run_id=r.id) as stages,
                (select row_to_json(d) from (select decision, reviewer, comment, candidate_revision, created_at::text as created_at
                   from public.human_decisions where run_id=r.id) d) as decision
         from public.runs r where r.id=$1`, [runId],
      );
      if (!result.rowCount) throw new NotFoundError('run_not_found');
      const { stages, decision, ...run } = result.rows[0]!;
      res.json({ run: RunStatusSchema.parse(run), stages: stages ?? [], decision: decision ?? null });
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
      const decision = HumanDecisionSchema.parse(req.body);
      await recordDecision(options.pool, runId, decision);
      res.status(201).json({ runId, decision: decision.decision, candidateRevision: decision.candidateRevision });
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
