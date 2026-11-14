import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Feedback, StartRunRequestSchema } from './contracts.js';
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
