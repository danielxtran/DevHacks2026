import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { NumericPatchSchema, SpecApprovalRequestSchema, SpecEditRequestSchema, SpecRevisionRequestSchema,
  SimulationQueueRequestSchema, type Feedback, type StartRunRequestSchema } from './contracts.js';
import { canonicalNumericPatch, validateHexlabConfig, validateSimulationResult, type HexlabConfig, type NumericChange } from './hexlab.js';
import { fingerprintFeedback } from './collectors.js';
import type { z } from 'zod';

export class ConflictError extends Error {}
export class NotFoundError extends Error {}

export interface SavedSweep {
  id: string;
  source: 'reddit' | 'r';
  pages: number;
  items: Feedback[];
  truncated: boolean;
}

async function upsertFeedback(client: PoolClient, row: Feedback): Promise<boolean> {
  const identity = await client.query(
    `select id, source, external_id, content_fingerprint from public.feedback_posts
     where id = $1 or (fixture_set = $2 and source = $3 and external_id = $4)
     for update`,
    [row.id, row.fixture_set, row.source, row.external_id],
  );
  if (identity.rows.some((existing) => existing.id !== row.id || existing.source !== row.source || existing.external_id !== row.external_id)) {
    throw new ConflictError(`Source identity collision for ${row.source}/${row.external_id}`);
  }

  const old = identity.rows.find((existing) => existing.id === row.id);
  const fingerprint = fingerprintFeedback(row);
  const parentExists = row.parent_id === null || (await client.query('select 1 from public.feedback_posts where id = $1', [row.parent_id])).rowCount === 1;
  const threadExists = row.thread_id === null || (await client.query('select 1 from public.feedback_posts where id = $1', [row.thread_id])).rowCount === 1;
  if (!parentExists || !threadExists) {
    await client.query(
      `insert into public.pending_feedback (id, source, external_id, payload, last_error, attempts, updated_at)
       values ($1,$2,$3,$4::jsonb,'parent not present yet',0,now())
       on conflict (id) do update set payload = excluded.payload, last_error = excluded.last_error,
         attempts = pending_feedback.attempts + 1, updated_at = now()`,
      [row.id, row.source, row.external_id, JSON.stringify(row)],
    );
    return false;
  }

  await client.query(
    `insert into public.feedback_posts
      (id, fixture_set, source, author, body, score, posted_at, kind, title, parent_id, thread_id,
       num_comments, external_id, source_url, content_fingerprint, fetched_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
     on conflict (id) do update set
       author = excluded.author, body = excluded.body, score = excluded.score, posted_at = excluded.posted_at,
       kind = excluded.kind, title = excluded.title, parent_id = excluded.parent_id, thread_id = excluded.thread_id,
       num_comments = excluded.num_comments, source_url = excluded.source_url,
       content_fingerprint = excluded.content_fingerprint, fetched_at = now()
     where feedback_posts.source = excluded.source and feedback_posts.external_id = excluded.external_id`,
    [row.id, row.fixture_set, row.source, row.author, row.body, row.score, row.posted_at, row.kind,
      row.title, row.parent_id, row.thread_id, row.num_comments, row.external_id, row.source_url, fingerprint],
  );

  await client.query('delete from public.pending_feedback where id = $1', [row.id]);
  if (!old || old.content_fingerprint !== fingerprint) {
    await client.query(
      `insert into public.discovery_queue (feedback_id) values ($1)
       on conflict (feedback_id) do nothing`,
      [row.id],
    );
  }
  return true;
}

async function retryPending(client: PoolClient, source: 'reddit' | 'r'): Promise<void> {
  const pending = await client.query<{ payload: Feedback }>(
    'select payload from public.pending_feedback where source = $1 order by updated_at limit 500 for update',
    [source],
  );
  for (const { payload } of pending.rows) await upsertFeedback(client, payload);
}

export async function persistSweep(pool: Pool, sweep: SavedSweep): Promise<{ status: 'complete' | 'incomplete'; pending: number }> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const row of sweep.items) await upsertFeedback(client, row);
    await retryPending(client, sweep.source);
    const pendingResult = await client.query<{ count: string }>(
      'select count(*)::text as count from public.pending_feedback where source = $1', [sweep.source],
    );
    const pending = Number(pendingResult.rows[0]?.count ?? 0);
    const status = sweep.truncated || pending > 0 ? 'incomplete' : 'complete';
    await client.query(
      `update public.collection_sweeps set status = $2, pages = $3, items = $4,
         truncated = $5, completed_at = now(), error = case when $2 = 'incomplete' and $5 then 'item cap reached' else null end
       where id = $1`,
      [sweep.id, status, sweep.pages, sweep.items.length, sweep.truncated],
    );
    await client.query('commit');
    return { status, pending };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function beginSweep(pool: Pool, source: 'reddit' | 'r'): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into public.collection_sweeps (source, status) values ($1, 'running') returning id`, [source],
  );
  return result.rows[0]!.id;
}

export async function failSweep(pool: Pool, id: string, error: unknown): Promise<void> {
  await pool.query(
    `update public.collection_sweeps set status = 'failed', error = $2, completed_at = now() where id = $1`,
    [id, error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)],
  );
}

export async function startSelectedRun(
  pool: Pool,
  issueId: string,
  body: z.infer<typeof StartRunRequestSchema>,
  baselineRevision: string,
  scenarios: unknown,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `select public.start_selected_run($1::uuid, $2, $3, $4::jsonb) as id`,
    [issueId, body.idempotencyKey, baselineRevision, JSON.stringify(scenarios)],
  );
  return result.rows[0]!.id;
}

export interface IssueMetadata {
  expectedRevision: number;
  actor: string;
  developer?: 'dev' | 'jun' | 'marco' | 'ana' | 'priya' | null | undefined;
  title?: string | undefined;
  tags?: string[] | undefined;
}

type IssueRow = Record<string, unknown> & { revision: number; triage_state: string };

async function lockIssue(client: PoolClient, issueId: string, expectedRevision: number): Promise<IssueRow> {
  const current = await client.query<IssueRow>(
    `select id, title, summary, category::text as category, target, target_type, tags,
        human_title, human_tags, assigned_developer, triage_state, canonical_issue_id, revision
     from public.discovered_issues where id=$1 for update`, [issueId],
  );
  if (!current.rowCount) throw new NotFoundError('issue_not_found');
  if (current.rows[0]!.revision !== expectedRevision) throw new ConflictError('issue_revision_conflict');
  return current.rows[0]!;
}

async function appendIssueActivity(client: PoolClient, issueId: string, event: string, actor: string, body: string | null, details: unknown = {}): Promise<void> {
  await client.query(
    `insert into public.issue_activity (issue_id,event_type,actor,body,details)
     values ($1,$2,$3,$4,$5::jsonb)`, [issueId, event, actor, body, JSON.stringify(details)],
  );
}

export async function updateIssueMetadata(pool: Pool, issueId: string, change: IssueMetadata): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const current = await lockIssue(client, issueId, change.expectedRevision);
    if (current.triage_state === 'merged') throw new ConflictError('issue_merged');

    const updated = await client.query<Record<string, unknown>>(
      `update public.discovered_issues set
         assigned_developer=case when $3::boolean then $4::text else assigned_developer end,
         human_title=case when $5::boolean then $6::text else human_title end,
         human_tags=case when $7::boolean then $8::text[] else human_tags end,
         revision=revision+1, updated_at=now()
       where id=$1 and revision=$2 returning id, title, summary, category::text as category,
         target, target_type, tags, human_title, human_tags, assigned_developer, triage_state, revision`,
      [issueId, change.expectedRevision, change.developer !== undefined, change.developer ?? null,
        change.title !== undefined, change.title ?? null, change.tags !== undefined, change.tags ?? null],
    );
    if (!updated.rowCount) throw new ConflictError('issue_revision_conflict');
    await appendIssueActivity(client, issueId, 'metadata_updated', change.actor, null, {
      ...(change.developer !== undefined ? { developer: change.developer } : {}),
      ...(change.title !== undefined ? { title: change.title } : {}),
      ...(change.tags !== undefined ? { tags: change.tags } : {}),
    });
    await client.query('commit');
    return updated.rows[0]!;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function addIssueComment(pool: Pool, issueId: string, command: { expectedRevision: number; actor: string; text: string }): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const issue = await lockIssue(client, issueId, command.expectedRevision);
    if (issue.triage_state === 'merged') throw new ConflictError('issue_merged');
    const comment = await client.query<Record<string, unknown>>(
      `insert into public.issue_activity (issue_id,event_type,actor,body)
       values ($1,'comment',$2,$3) returning id,actor,body,created_at::text as created_at`,
      [issueId, command.actor, command.text],
    );
    await client.query('update public.discovered_issues set revision=revision+1,updated_at=now() where id=$1', [issueId]);
    await client.query('commit');
    return comment.rows[0]!;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

export async function dismissIssue(pool: Pool, issueId: string, command: { expectedRevision: number; actor: string; reason: string }): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const issue = await lockIssue(client, issueId, command.expectedRevision);
    if (issue.triage_state !== 'open') throw new ConflictError('issue_not_open');
    await client.query(
      `update public.discovered_issues set triage_state='dismissed', dismissed_by=$2,
         dismissed_reason=$3, dismissed_at=now(), revision=revision+1, updated_at=now() where id=$1`,
      [issueId, command.actor, command.reason],
    );
    await appendIssueActivity(client, issueId, 'dismissed', command.actor, command.reason);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

export async function restoreIssue(pool: Pool, issueId: string, command: { expectedRevision: number; actor: string }): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const issue = await lockIssue(client, issueId, command.expectedRevision);
    if (issue.triage_state !== 'dismissed') throw new ConflictError('issue_not_dismissed');
    await client.query(
      `update public.discovered_issues set triage_state='open',revision=revision+1,updated_at=now() where id=$1`, [issueId],
    );
    await appendIssueActivity(client, issueId, 'restored', command.actor, null);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

export async function mergeIssues(pool: Pool, issueId: string, command: {
  expectedRevision: number; expectedCanonicalRevision: number; actor: string; canonicalIssueId: string;
}): Promise<Record<string, unknown>> {
  if (issueId === command.canonicalIssueId) throw new ConflictError('cannot_merge_issue_into_self');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const locked = await client.query<IssueRow>(
      `select id,triage_state,canonical_issue_id,revision from public.discovered_issues
       where id=any($1::uuid[]) order by id for update`, [[issueId, command.canonicalIssueId]],
    );
    const source = locked.rows.find(row => row.id === issueId);
    const target = locked.rows.find(row => row.id === command.canonicalIssueId);
    if (!source || !target) throw new NotFoundError('issue_not_found');
    if (source.revision !== command.expectedRevision || target.revision !== command.expectedCanonicalRevision) throw new ConflictError('issue_revision_conflict');
    if (source.triage_state === 'merged' || target.triage_state !== 'open' || target.canonical_issue_id) {
      throw new ConflictError('merge_target_not_canonical');
    }
    const active = await client.query(
      `select 1 from public.runs where selected_issue_id=any($1::uuid[]) and
        ((experiment_kind='hexlab_numeric' and lifecycle_phase not in ('accepted','experiment_rejected','spec_rejected'))
         or (experiment_kind<>'hexlab_numeric' and status::text not in ('done','failed','review'))) limit 1`,
      [[issueId, command.canonicalIssueId]],
    );
    if (active.rowCount) throw new ConflictError('active_run_exists');
    await client.query(
      `insert into public.discovered_issue_memberships (issue_id,feedback_id)
       select $2,m.feedback_id from public.discovered_issue_memberships m where m.issue_id=$1
       on conflict (issue_id,feedback_id) do nothing`, [issueId, command.canonicalIssueId],
    );
    await client.query(
      `update public.discovered_issues set triage_state='merged',canonical_issue_id=$2,
         revision=revision+1,updated_at=now() where id=$1`, [issueId, command.canonicalIssueId],
    );
    await client.query(
      `update public.discovered_issues set revision=revision+1,updated_at=now() where id=$1`, [command.canonicalIssueId],
    );
    await appendIssueActivity(client, issueId, 'merged', command.actor, null, { canonicalIssueId: command.canonicalIssueId });
    await appendIssueActivity(client, command.canonicalIssueId, 'merged', command.actor, null, { sourceIssueId: issueId });
    await client.query('commit');
    return { id: issueId, canonicalIssueId: command.canonicalIssueId, revision: command.expectedRevision + 1,
      canonicalRevision: command.expectedCanonicalRevision + 1 };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

export interface HexlabBaseline {
  baselineConfigId: string;
  engineId: string;
  config: Record<string, unknown>;
}

export async function startNumericExperiment(pool: Pool, issueId: string, body: {
  idempotencyKey: string; actor: string;
}, baseline: HexlabBaseline): Promise<string> {
  const client = await pool.connect();
  const fingerprint = requestHash([issueId, body.idempotencyKey, body.actor, baseline.baselineConfigId, baseline.engineId]);
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('devhacks.numeric-experiment'))");
    const existing = await client.query<{ id: string; request_hash: string }>(
      'select id,request_hash from public.runs where idempotency_key=$1 for update', [body.idempotencyKey],
    );
    if (existing.rowCount) {
      if (existing.rows[0]!.request_hash !== fingerprint) throw new ConflictError('idempotency_conflict');
      await client.query('commit');
      return existing.rows[0]!.id;
    }
    const issueResult = await client.query<Record<string, unknown> & {
      id: string; title: string; summary: string; assigned_developer: string | null; triage_state: string;
    }>(
      `select id,title,summary,category::text as category,target,target_type,tags,
          assigned_developer,triage_state from public.discovered_issues where id=$1 for update`, [issueId],
    );
    if (!issueResult.rowCount) throw new NotFoundError('issue_not_found');
    const issue = issueResult.rows[0]!;
    if (issue.triage_state !== 'open') throw new ConflictError('issue_not_open');
    if (!issue.assigned_developer) throw new ConflictError('developer_assignment_required');

    const active = await client.query(
      `select 1 from public.runs where selected_issue_id is not null and
        ((experiment_kind='hexlab_numeric' and lifecycle_phase not in ('accepted','experiment_rejected','spec_rejected'))
         or (experiment_kind='source_code' and status::text not in ('done','failed','review'))) limit 1`,
    );
    if (active.rowCount) throw new ConflictError('active_run_exists');

    const inserted = await client.query<{ id: string }>(
      `insert into public.runs
         (mode,fixture_set,status,selected_issue_id,idempotency_key,request_hash,workflow_stage,
          experiment_kind,lifecycle_phase,revision,baseline_config_id,baseline_config,engine_id,simulation_generation)
       values ('ours','mock-live','queued',$1,$2,$3,'spec_queued','hexlab_numeric','spec_queued',1,$4,$5::jsonb,$6,0)
       returning id`,
      [issueId, body.idempotencyKey, fingerprint, baseline.baselineConfigId, JSON.stringify(baseline.config), baseline.engineId],
    );
    const runId = inserted.rows[0]!.id;
    await client.query(
      `insert into public.issues (run_id,id,target,target_type,claim,post_ids,post_count,sources,quotes,evidence)
       select $1,i.id::text,i.target,i.target_type,i.category,
         coalesce(array_agg(fp.id order by fp.posted_at) filter (where fp.id is not null),'{}'),
         count(fp.id)::integer,
         coalesce(array_agg(distinct fp.source) filter (where fp.source is not null),'{}'),
         coalesce(array_agg(fp.body order by fp.posted_at) filter (where fp.id is not null),'{}'),
         jsonb_build_object('title',coalesce(i.human_title,i.title),'summary',i.summary,'tags',coalesce(i.human_tags,i.tags))
       from public.discovered_issues i
       left join public.discovered_issue_memberships m on m.issue_id=i.id
       left join public.feedback_posts fp on fp.id=m.feedback_id
       where i.id=$2 group by i.id`, [runId, issueId],
    );
    await client.query(
      `insert into public.run_feedback_snapshots(run_id,issue_id,feedback_id,payload)
       select $1,m.issue_id::text,fp.id,to_jsonb(fp) from public.discovered_issue_memberships m
       join public.feedback_posts fp on fp.id=m.feedback_id where m.issue_id=$2`, [runId, issueId],
    );
    const jobKey = `initial:${runId}`;
    await client.query(
      `insert into public.workflow_jobs(run_id,kind,state,generation,idempotency_key,request_hash,input)
       values ($1,'spec_initial','queued',0,$2,$3,$4::jsonb)`,
      [runId, jobKey, requestHash([runId, 'spec_initial', 0]), JSON.stringify({ issueId })],
    );
    await appendIssueActivity(client, issueId, 'experiment_started', body.actor, null, { runId });
    await client.query('commit');
    return runId;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

interface NumericRunRow extends Record<string, unknown> {
  id: string; selected_issue_id: string; experiment_kind: string; lifecycle_phase: string;
  revision: number; simulation_generation: number; current_spec_version_id: string | null;
  approved_spec_version_id: string | null; baseline_config_id: string; baseline_config: Record<string, unknown>;
  engine_id: string; status: string;
}

async function lockNumericRun(client: PoolClient, runId: string, expectedRevision: number): Promise<NumericRunRow> {
  const result = await client.query<NumericRunRow>(
    `select id,selected_issue_id,experiment_kind,lifecycle_phase,revision,simulation_generation,
        current_spec_version_id,approved_spec_version_id,baseline_config_id,baseline_config,engine_id,status::text as status
     from public.runs where id=$1 for update`, [runId],
  );
  if (!result.rowCount) throw new NotFoundError('run_not_found');
  const run = result.rows[0]!;
  if (run.experiment_kind !== 'hexlab_numeric') throw new ConflictError('not_numeric_experiment');
  if (run.revision !== expectedRevision) throw new ConflictError('run_revision_conflict');
  return run;
}

function frozenConfig(run: NumericRunRow): HexlabConfig {
  return validateHexlabConfig({ ...run.baseline_config, baselineConfigId: run.baseline_config_id, engineId: run.engine_id });
}

async function currentSpec(client: PoolClient, run: NumericRunRow): Promise<Record<string, any>> {
  if (!run.current_spec_version_id) throw new ConflictError('spec_not_ready');
  const result = await client.query<Record<string, any>>(
    `select id,version_number,markdown,structured_spec,numeric_patch,author_kind,author
     from public.spec_versions where run_id=$1 and id=$2`, [run.id, run.current_spec_version_id],
  );
  if (!result.rowCount) throw new ConflictError('current_spec_missing');
  return result.rows[0]!;
}

async function assertNoActiveJob(client: PoolClient, runId: string): Promise<void> {
  const result = await client.query(
    "select 1 from public.workflow_jobs where run_id=$1 and state in ('queued','running') limit 1", [runId],
  );
  if (result.rowCount) throw new ConflictError('workflow_job_active');
}

export async function queueSpecRevision(pool: Pool, runId: string, command: z.infer<typeof SpecRevisionRequestSchema>): Promise<{ jobId: string }> {
  const client = await pool.connect();
  const hash = requestHash([runId, command.actor, command.prompt, command.expectedVersion]);
  try {
    await client.query('begin');
    const prior = await client.query<{ id: string; request_hash: string }>(
      `select id,request_hash from public.workflow_jobs where run_id=$1 and kind='spec_revision' and idempotency_key=$2 for update`,
      [runId, command.idempotencyKey],
    );
    if (prior.rowCount) {
      if (prior.rows[0]!.request_hash !== hash) throw new ConflictError('idempotency_conflict');
      await client.query('commit');
      return { jobId: prior.rows[0]!.id };
    }
    const run = await lockNumericRun(client, runId, command.expectedRevision);
    if (run.lifecycle_phase !== 'spec_review') throw new ConflictError('spec_not_in_review');
    const spec = await currentSpec(client, run);
    if (spec.version_number !== command.expectedVersion) throw new ConflictError('spec_version_conflict');
    await assertNoActiveJob(client, runId);
    const inserted = await client.query<{ id: string }>(
      `insert into public.workflow_jobs(run_id,kind,state,generation,max_attempts,idempotency_key,request_hash,input)
       values ($1,'spec_revision','queued',$2,1,$3,$4,$5::jsonb) returning id`,
      [runId, run.simulation_generation, command.idempotencyKey, hash,
        JSON.stringify({ prompt: command.prompt, parentVersionId: run.current_spec_version_id })],
    );
    await client.query(
      `update public.runs set lifecycle_phase='spec_queued',workflow_stage='spec_queued',status='queued',error=null,
        finished_at=null,revision=revision+1 where id=$1`, [runId],
    );
    await appendIssueActivity(client, run.selected_issue_id, 'spec_version_saved', command.actor, null,
      { runId, requestedRevision: true, prompt: command.prompt });
    await client.query('commit');
    return { jobId: inserted.rows[0]!.id };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

export async function saveSpecVersion(pool: Pool, runId: string, command: z.infer<typeof SpecEditRequestSchema>): Promise<{ id: string; version: number }> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const run = await lockNumericRun(client, runId, command.expectedRevision);
    if (run.lifecycle_phase !== 'spec_review') throw new ConflictError('spec_not_in_review');
    await assertNoActiveJob(client, runId);
    const current = await currentSpec(client, run);
    if (current.version_number !== command.expectedVersion) throw new ConflictError('spec_version_conflict');
    const baseResult = await client.query<Record<string, any>>(
      `select id,markdown,structured_spec,numeric_patch from public.spec_versions
       where run_id=$1 and id=$2`, [runId, command.baseSpecVersionId ?? current.id],
    );
    if (!baseResult.rowCount) throw new NotFoundError('spec_version_not_found');
    const base = baseResult.rows[0]!;
    const markdown = command.markdown ?? base.markdown;
    let patch = NumericPatchSchema.parse(command.numericPatch ?? base.numeric_patch);
    if (patch.length) patch = canonicalNumericPatch(patch, frozenConfig(run), 'pve');
    const next = await client.query<{ id: string; version_number: number }>(
      `insert into public.spec_versions(run_id,version_number,parent_version_id,author_kind,author,markdown,
          structured_spec,numeric_patch,note)
       values ($1,(select coalesce(max(version_number),0)+1 from public.spec_versions where run_id=$1),
          $2,'human',$3,$4,$5::jsonb,$6::jsonb,$7) returning id,version_number`,
      [runId, base.id, command.actor, markdown, JSON.stringify(base.structured_spec), JSON.stringify(patch), command.note],
    );
    await client.query(
      `update public.runs set current_spec_version_id=$2,lifecycle_phase='spec_review',workflow_stage='spec_review',
         revision=revision+1 where id=$1`, [runId, next.rows[0]!.id],
    );
    await appendIssueActivity(client, run.selected_issue_id, 'spec_version_saved', command.actor, null,
      { runId, specVersionId: next.rows[0]!.id, version: next.rows[0]!.version_number, note: command.note });
    await client.query('commit');
    return { id: next.rows[0]!.id, version: next.rows[0]!.version_number };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

async function insertSimulationJob(client: PoolClient, run: NumericRunRow, approvalId: string,
  input: { patch: NumericChange[]; seed: number; mode: 'pvp' | 'pve'; battles: 100 | 1000 | 5000 | 10000 },
  generation: number, idempotencyKey: string, hash: string): Promise<{ jobId: string; simulationId: string }> {
  const simulationId = randomUUID();
  const job = await client.query<{ id: string }>(
    `insert into public.workflow_jobs(run_id,kind,state,generation,max_attempts,idempotency_key,request_hash,input)
     values ($1,'simulation','queued',$2,2,$3,$4,$5::jsonb) returning id`,
    [run.id, generation, idempotencyKey, hash, JSON.stringify({ simulationId, approvalId })],
  );
  await client.query(
    `insert into public.hexlab_simulations(id,run_id,spec_version_id,approval_id,job_id,generation,state,
       baseline_config_id,engine_id,numeric_patch,seed,mode,battles)
     values ($1,$2,$3,$4,$5,$6,'queued',$7,$8,$9::jsonb,$10,$11,$12)`,
    [simulationId, run.id, run.approved_spec_version_id, approvalId, job.rows[0]!.id, generation,
      run.baseline_config_id, run.engine_id, JSON.stringify(input.patch), input.seed, input.mode, input.battles],
  );
  return { jobId: job.rows[0]!.id, simulationId };
}

async function priorSimulationCommand(client: PoolClient, runId: string, idempotencyKey: string, hash: string): Promise<string | null> {
  const result = await client.query<{ id: string; request_hash: string; input: { simulationId?: string } }>(
    `select id,request_hash,input from public.workflow_jobs where run_id=$1 and kind='simulation' and idempotency_key=$2 for update`,
    [runId, idempotencyKey],
  );
  if (!result.rowCount) return null;
  if (result.rows[0]!.request_hash !== hash) throw new ConflictError('idempotency_conflict');
  if (!result.rows[0]!.input.simulationId) throw new ConflictError('simulation_id_missing');
  return result.rows[0]!.input.simulationId;
}

export async function approveNumericSpec(pool: Pool, runId: string, command: z.infer<typeof SpecApprovalRequestSchema>): Promise<{ simulationId: string }> {
  const client = await pool.connect();
  const hash = requestHash([runId, command.actor, command.specVersionId, command.baselineConfigId, command.engineId,
    command.numericPatch, command.seed, command.mode, command.battles]);
  const key = `approve:${command.idempotencyKey}`;
  try {
    await client.query('begin');
    const prior = await priorSimulationCommand(client, runId, key, hash);
    if (prior) { await client.query('commit'); return { simulationId: prior }; }
    const run = await lockNumericRun(client, runId, command.expectedRevision);
    if (run.lifecycle_phase !== 'spec_review' || run.current_spec_version_id !== command.specVersionId) throw new ConflictError('spec_version_not_current');
    await assertNoActiveJob(client, runId);
    if (command.baselineConfigId !== run.baseline_config_id || command.engineId !== run.engine_id) throw new ConflictError('baseline_identity_changed');
    const config = frozenConfig(run);
    const patch = canonicalNumericPatch(command.numericPatch, config, command.mode);
    const spec = await client.query<{ numeric_patch: NumericChange[] }>(
      'select numeric_patch from public.spec_versions where run_id=$1 and id=$2', [runId, command.specVersionId],
    );
    if (!spec.rowCount) throw new NotFoundError('spec_version_not_found');
    const approvedPatch = canonicalNumericPatch(spec.rows[0]!.numeric_patch, config, command.mode);
    if (JSON.stringify(patch) !== JSON.stringify(approvedPatch)) throw new ConflictError('patch_differs_from_saved_spec');
    await client.query("update public.spec_approvals set state='invalidated',invalidated_at=now() where run_id=$1 and state='approved'", [runId]);
    const approval = await client.query<{ id: string }>(
      `insert into public.spec_approvals(run_id,spec_version_id,state,baseline_config_id,baseline_config,engine_id,
         numeric_patch,seed,mode,battles,actor)
       values ($1,$2,'approved',$3,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10) returning id`,
      [runId, command.specVersionId, run.baseline_config_id, JSON.stringify(run.baseline_config), run.engine_id,
        JSON.stringify(patch), command.seed, command.mode, command.battles, command.actor],
    );
    const nextGeneration = run.simulation_generation + 1;
    const nextRun = { ...run, approved_spec_version_id: command.specVersionId };
    const queued = await insertSimulationJob(client, nextRun, approval.rows[0]!.id,
      { patch, seed: command.seed, mode: command.mode, battles: command.battles }, nextGeneration, key, hash);
    await client.query(
      `update public.runs set approved_spec_version_id=$2,simulation_generation=$3,lifecycle_phase='simulation_queued',
         workflow_stage='simulation_queued',status='verifying',error=null,revision=revision+1 where id=$1`,
      [runId, command.specVersionId, nextGeneration],
    );
    await client.query('commit');
    return { simulationId: queued.simulationId };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

export async function queueSimulationRerun(pool: Pool, runId: string, command: z.infer<typeof SimulationQueueRequestSchema>): Promise<{ simulationId: string }> {
  const client = await pool.connect();
  const hash = requestHash([runId, command.actor, command.battles]);
  const key = `rerun:${command.idempotencyKey}`;
  try {
    await client.query('begin');
    const prior = await priorSimulationCommand(client, runId, key, hash);
    if (prior) { await client.query('commit'); return { simulationId: prior }; }
    const run = await lockNumericRun(client, runId, command.expectedRevision);
    if (!['simulation_review', 'failed'].includes(run.lifecycle_phase)) throw new ConflictError('simulation_not_rerunnable');
    await assertNoActiveJob(client, runId);
    const approval = await client.query<Record<string, any>>(
      `select id,state,baseline_config_id,engine_id,numeric_patch,seed,mode
       from public.spec_approvals where run_id=$1 and state='approved' for update`, [runId],
    );
    if (!approval.rowCount || approval.rows[0]!.baseline_config_id !== run.baseline_config_id
      || approval.rows[0]!.engine_id !== run.engine_id) throw new ConflictError('approved_inputs_missing');
    const saved = approval.rows[0]!;
    const patch = canonicalNumericPatch(saved.numeric_patch, frozenConfig(run), saved.mode);
    const generation = run.simulation_generation + 1;
    const queued = await insertSimulationJob(client, { ...run, approved_spec_version_id: run.approved_spec_version_id }, saved.id,
      { patch, seed: Number(saved.seed), mode: saved.mode, battles: command.battles }, generation, key, hash);
    await client.query(
      `update public.runs set simulation_generation=$2,lifecycle_phase='simulation_queued',workflow_stage='simulation_queued',
         status='verifying',error=null,revision=revision+1 where id=$1`, [runId, generation],
    );
    await client.query('commit');
    return { simulationId: queued.simulationId };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

export async function retryHexlabSimulation(pool: Pool, runId: string, simulationId: string, command: {
  expectedRevision: number; actor: string; idempotencyKey: string;
}): Promise<void> {
  const client = await pool.connect();
  const hash = requestHash([runId, simulationId, command.actor]);
  try {
    await client.query('begin');
    const run = await lockNumericRun(client, runId, command.expectedRevision);
    const result = await client.query<Record<string, any>>(
      `select s.id,s.state,s.generation,s.job_id,j.state as job_state,j.attempt,j.max_attempts,
          j.last_retry_key,j.last_retry_hash
       from public.hexlab_simulations s join public.workflow_jobs j on j.id=s.job_id
       where s.run_id=$1 and s.id=$2 for update of s,j`, [runId, simulationId],
    );
    if (!result.rowCount) throw new NotFoundError('simulation_not_found');
    const item = result.rows[0]!;
    if (item.last_retry_key === command.idempotencyKey) {
      if (item.last_retry_hash !== hash) throw new ConflictError('idempotency_conflict');
      await client.query('commit');
      return;
    }
    if (!['failed', 'interrupted'].includes(item.state) || !['failed', 'interrupted'].includes(item.job_state)) {
      throw new ConflictError('simulation_not_retryable');
    }
    if (Number(item.attempt) >= Number(item.max_attempts)) throw new ConflictError('simulation_retry_limit_reached');
    if (item.generation !== run.simulation_generation) throw new ConflictError('simulation_generation_retired');
    const generation = run.simulation_generation + 1;
    await client.query(
      `update public.workflow_jobs set state='queued',generation=$2,error=null,started_at=null,completed_at=null,
         last_retry_key=$3,last_retry_hash=$4 where id=$1`, [item.job_id, generation, command.idempotencyKey, hash],
    );
    await client.query(
      `update public.hexlab_simulations set state='queued',generation=$2,error=null,started_at=null,completed_at=null where id=$1`,
      [simulationId, generation],
    );
    await client.query(
      `update public.runs set simulation_generation=$2,lifecycle_phase='simulation_queued',workflow_stage='simulation_queued',
         status='verifying',error=null,revision=revision+1 where id=$1`, [runId, generation],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

export async function rejectNumericSpec(pool: Pool, runId: string, command: {
  expectedRevision: number; actor: string; specVersionId: string; reason: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const run = await lockNumericRun(client, runId, command.expectedRevision);
    if (run.lifecycle_phase !== 'spec_review' || run.current_spec_version_id !== command.specVersionId) throw new ConflictError('spec_version_not_current');
    await assertNoActiveJob(client, runId);
    await client.query(
      `update public.runs set lifecycle_phase='spec_rejected',workflow_stage='spec_rejected',status='failed',
         error=$2,finished_at=now(),revision=revision+1 where id=$1`, [runId, command.reason],
    );
    await appendIssueActivity(client, run.selected_issue_id, 'spec_rejected', command.actor, command.reason, { runId, specVersionId: command.specVersionId });
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

export async function returnNumericExperimentToDevelopment(pool: Pool, runId: string, command: {
  expectedRevision: number; actor: string; reason: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const run = await lockNumericRun(client, runId, command.expectedRevision);
    if (['accepted', 'experiment_rejected', 'spec_rejected'].includes(run.lifecycle_phase)) throw new ConflictError('experiment_finalized');
    await client.query("update public.workflow_jobs set state='retired',completed_at=now(),error='Returned to Development' where run_id=$1 and state in ('queued','running')", [runId]);
    await client.query("update public.hexlab_simulations set state='retired',completed_at=now(),error='Returned to Development' where run_id=$1 and state in ('queued','running')", [runId]);
    await client.query("update public.spec_approvals set state='invalidated',invalidated_at=now() where run_id=$1 and state='approved'", [runId]);
    await client.query(
      `update public.runs set approved_spec_version_id=null,simulation_generation=simulation_generation+1,
         lifecycle_phase='spec_review',workflow_stage='spec_review',status='review',error=null,finished_at=null,revision=revision+1
       where id=$1`, [runId],
    );
    await appendIssueActivity(client, run.selected_issue_id, 'returned_to_development', command.actor, command.reason, { runId });
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

export async function recordNumericDecision(pool: Pool, runId: string, command: {
  expectedRevision: number; actor: string; decision: 'accept' | 'reject'; comment: string;
  specVersionId: string; simulationId: string;
}): Promise<{ decision: string; candidateIdentity: string }> {
  const client = await pool.connect();
  const hash = requestHash([command.decision, command.actor, command.comment, command.specVersionId, command.simulationId]);
  try {
    await client.query('begin');
    const prior = await client.query<{ request_hash: string; decision: string; candidate_identity: string }>(
      'select request_hash,decision,candidate_identity from public.human_decisions where run_id=$1 for update', [runId],
    );
    if (prior.rowCount) {
      if (prior.rows[0]!.request_hash !== hash) throw new ConflictError('decision_conflict');
      await client.query('commit');
      return { decision: prior.rows[0]!.decision, candidateIdentity: prior.rows[0]!.candidate_identity };
    }
    const run = await lockNumericRun(client, runId, command.expectedRevision);
    if (run.lifecycle_phase !== 'simulation_review' || run.approved_spec_version_id !== command.specVersionId) {
      throw new ConflictError('experiment_not_ready_for_decision');
    }
    const saved = await client.query<Record<string, any>>(
      `select id,spec_version_id,generation,state,baseline_config_id,engine_id,numeric_patch,seed,mode,battles,result
       from public.hexlab_simulations where run_id=$1 and id=$2 for update`, [runId, command.simulationId],
    );
    if (!saved.rowCount) throw new NotFoundError('simulation_not_found');
    const simulation = saved.rows[0]!;
    if (simulation.spec_version_id !== command.specVersionId || simulation.state !== 'succeeded'
      || simulation.generation !== run.simulation_generation || simulation.baseline_config_id !== run.baseline_config_id
      || simulation.engine_id !== run.engine_id) throw new ConflictError('simulation_identity_mismatch');
    const patch = canonicalNumericPatch(simulation.numeric_patch, frozenConfig(run), simulation.mode);
    validateSimulationResult(simulation.result, {
      baselineConfigId: simulation.baseline_config_id, engineId: simulation.engine_id,
      numericPatch: patch, seed: Number(simulation.seed), mode: simulation.mode as 'pvp' | 'pve',
      battles: Number(simulation.battles) as 100 | 1000 | 5000 | 10000,
    });
    const candidateIdentity = createHash('sha256').update(JSON.stringify([
      simulation.baseline_config_id, simulation.engine_id, patch,
    ])).digest('hex');
    await client.query(
      `insert into public.human_decisions(run_id,decision,reviewer,comment,candidate_revision,request_hash,
         spec_version_id,simulation_id,candidate_identity)
       values ($1,$2,$3,$4,null,$5,$6,$7,$8)`,
      [runId, command.decision, command.actor, command.comment, hash, command.specVersionId, command.simulationId, candidateIdentity],
    );
    const phase = command.decision === 'accept' ? 'accepted' : 'experiment_rejected';
    await client.query(
      `update public.runs set lifecycle_phase=$2,workflow_stage=$2,status='done',finished_at=now(),revision=revision+1 where id=$1`,
      [runId, phase],
    );
    await appendIssueActivity(client, run.selected_issue_id, 'experiment_finalized', command.actor, command.comment,
      { runId, decision: command.decision, specVersionId: command.specVersionId, simulationId: command.simulationId, candidateIdentity });
    await client.query('commit');
    return { decision: command.decision, candidateIdentity };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

export function requestHash(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export async function recordDecision(pool: Pool, runId: string, decision: {
  decision: 'accept' | 'reject'; reviewer: string; comment: string; candidateRevision: string;
}): Promise<void> {
  const client = await pool.connect();
  const hash = requestHash([decision.decision, decision.reviewer, decision.comment, decision.candidateRevision]);
  try {
    await client.query('begin');
    const run = await client.query<{ status: string; candidate_revision: string | null }>(
      'select status::text, candidate_revision from public.runs where id = $1 for update', [runId],
    );
    if (!run.rowCount) throw new NotFoundError('run_not_found');
    const current = run.rows[0]!;
    if (current.status !== 'review' && current.status !== 'done') throw new ConflictError('run_not_ready_for_review');
    if (current.candidate_revision !== decision.candidateRevision) throw new ConflictError('candidate_revision_mismatch');

    const existing = await client.query<{ request_hash: string }>(
      'select request_hash from public.human_decisions where run_id = $1', [runId],
    );
    if (existing.rowCount) {
      if (existing.rows[0]!.request_hash !== hash) throw new ConflictError('decision_conflict');
      await client.query('commit');
      return;
    }
    await client.query(
      `insert into public.human_decisions (run_id, decision, reviewer, comment, candidate_revision, request_hash)
       values ($1,$2,$3,$4,$5,$6)`,
      [runId, decision.decision, decision.reviewer, decision.comment, decision.candidateRevision, hash],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcileInterruptedRuns(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const interrupted = await client.query<{ id: string; workflow_stage: string }>(
      `update public.runs set status = 'interrupted', workflow_stage = 'interrupted',
         error = coalesce(error, 'Worker stopped before the active stage was reconciled.')
       where status::text in ('collecting','gating','specing','implementing','verifying')
       returning id, workflow_stage`,
    );
    for (const run of interrupted.rows) {
      await client.query(
        `update public.run_stage_events set status = 'interrupted', completed_at = now(),
           error = coalesce(error, 'Process ended before stage completion.')
         where run_id = $1 and status = 'started'`, [run.id],
      );
      await client.query(
        `insert into public.run_stage_events (run_id, stage, status, error)
         values ($1, $2, 'interrupted', 'Process ended before stage completion.')`,
        [run.id, run.workflow_stage],
      );
    }
    await client.query("update public.discovery_queue set state = 'pending', updated_at = now() where state = 'processing'");
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function resumeRun(pool: Pool, runId: string): Promise<void> {
  const result = await pool.query(
    `update public.runs set status = 'queued', workflow_stage = 'resume_requested', error = null
     where id = $1 and status = 'interrupted' returning id`, [runId],
  );
  if (!result.rowCount) {
    const exists = await pool.query('select 1 from public.runs where id = $1', [runId]);
    if (!exists.rowCount) throw new NotFoundError('run_not_found');
    throw new ConflictError('run_not_interrupted');
  }
}
