import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { ConflictError, requestHash, retryNumericSpecification, startNumericExperiment } from './repository.js';

test('numeric experiment snapshots qualify joined issue fields and separate UUID and text identities', async () => {
  const issueId = '11111111-1111-4111-8111-111111111111';
  const runId = '22222222-2222-4222-8222-222222222222';
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let released = false;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes('from public.discovered_issues') && sql.includes('for update')) {
        return { rows: [{ id: issueId, assigned_developer: 'jun', triage_state: 'open' }], rowCount: 1 };
      }
      if (sql.includes('insert into public.runs')) return { rows: [{ id: runId }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; },
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const result = await startNumericExperiment(pool, issueId, { idempotencyKey: 'start-test', actor: 'You' }, {
    baselineConfigId: 'baseline-test', engineId: 'a'.repeat(64), config: {},
  });

  assert.equal(result, runId);
  const snapshot = calls.find(({ sql }) => sql.includes('insert into public.issues'));
  assert.ok(snapshot);
  assert.match(snapshot.sql, /select \$1,i\.id::text,i\.target,i\.target_type,i\.category,/);
  assert.match(snapshot.sql, /coalesce\(i\.human_title,i\.title\),'summary',i\.summary,'tags',coalesce\(i\.human_tags,i\.tags\)/);
  assert.deepEqual(snapshot.params, [runId, issueId]);
  const feedbackSnapshot = calls.find(({ sql }) => sql.includes('insert into public.run_feedback_snapshots'));
  assert.ok(feedbackSnapshot);
  assert.match(feedbackSnapshot.sql, /select \$1,m\.issue_id::text,fp\.id,to_jsonb\(fp\)/);
  assert.match(feedbackSnapshot.sql, /where m\.issue_id=\$2/);
  assert.deepEqual(feedbackSnapshot.params, [runId, issueId]);
  assert.ok(calls.some(({ sql }) => sql.includes('insert into public.workflow_jobs')));
  assert.equal(calls.at(-1)?.sql, 'commit');
  assert.equal(released, true);
});

const retryRunId = '22222222-2222-4222-8222-222222222222';
const retryCommand = { actor: 'You', expectedRevision: 2, idempotencyKey: 'retry-1' };

function specRetryFixture(runOverrides = {}, jobOverrides = {}, active = false) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const run = {
    id: retryRunId, selected_issue_id: '11111111-1111-4111-8111-111111111111',
    experiment_kind: 'hexlab_numeric', lifecycle_phase: 'spec_failed', revision: 2,
    simulation_generation: 0, current_spec_version_id: null, ...runOverrides,
  };
  const job = {
    id: '33333333-3333-4333-8333-333333333333', state: 'failed', generation: 0,
    attempt: 1, error: 'Model timed out', last_retry_key: null as string | null,
    last_retry_hash: null as string | null, ...jobOverrides,
  };
  const client = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes('from public.runs')) return { rows: [run], rowCount: 1 };
      if (sql.includes('from public.workflow_jobs') && sql.includes('last_retry_key')) return { rows: [job], rowCount: 1 };
      if (sql.includes('select 1 from public.workflow_jobs')) return { rows: [], rowCount: active ? 1 : 0 };
      if (sql.includes('update public.workflow_jobs')) {
        job.state = 'queued'; job.generation = Number(params[1]);
        job.last_retry_key = String(params[2]); job.last_retry_hash = String(params[3]);
      }
      if (sql.includes('update public.runs')) {
        run.lifecycle_phase = 'spec_queued'; run.revision++; run.simulation_generation = Number(params[1]);
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { pool: { connect: async () => client } as unknown as Pool, calls, run, job };
}

test('retry requeues the saved spec job and inputs without creating another experiment or spec', async () => {
  const { pool, calls, run, job } = specRetryFixture();
  assert.deepEqual(await retryNumericSpecification(pool, retryRunId, retryCommand), { jobId: job.id });
  assert.equal(run.lifecycle_phase, 'spec_queued');
  assert.equal(run.revision, 3);
  assert.equal(job.generation, 1);
  const update = calls.find(({ sql }) => sql.includes('update public.workflow_jobs'))!;
  assert.match(update.sql, /max_attempts=3/);
  assert.doesNotMatch(update.sql, /input=|attempt=0/);
  assert.ok(calls.some(({ sql, params }) => sql.includes('issue_activity') && String(params.at(-1)).includes('Model timed out')));
  assert.ok(calls.every(({ sql }) => !/insert into public\.(runs|workflow_jobs|spec_versions)/.test(sql)));
  assert.equal(calls.at(-1)?.sql, 'commit');
});

test('replaying a successful retry is idempotent even with the old run revision', async () => {
  const fixture = specRetryFixture();
  await retryNumericSpecification(fixture.pool, retryRunId, retryCommand);
  fixture.calls.length = 0;
  assert.deepEqual(await retryNumericSpecification(fixture.pool, retryRunId, retryCommand), { jobId: fixture.job.id });
  assert.equal(fixture.run.revision, 3);
  assert.ok(fixture.calls.every(({ sql }) => !sql.startsWith('update') && !sql.startsWith('insert')));
});

test('spec retry rejects conflicting payloads, stale edits, active/finalized jobs, retired generations and exhausted attempts', async t => {
  const cases: Array<{ name: string; run: Record<string, unknown>; job: Record<string, unknown>; active?: boolean; error: string }> = [
    { name: 'changed actor', run: {}, job: { last_retry_key: 'retry-1', last_retry_hash: requestHash([retryRunId, 'Someone else', 2]) }, error: 'idempotency_conflict' },
    { name: 'stale revision', run: { revision: 3 }, job: {}, error: 'run_revision_conflict' },
    { name: 'finalized', run: { lifecycle_phase: 'accepted' }, job: {}, error: 'spec_not_retryable' },
    { name: 'running', run: {}, job: { state: 'running' }, error: 'spec_not_retryable' },
    { name: 'retired', run: { simulation_generation: 2 }, job: {}, error: 'spec_generation_retired' },
    { name: 'limit', run: {}, job: { attempt: 3 }, error: 'spec_retry_limit_reached' },
    { name: 'another job active', run: {}, job: {}, active: true, error: 'workflow_job_active' },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { pool, calls } = specRetryFixture(scenario.run, scenario.job, scenario.active);
      await assert.rejects(retryNumericSpecification(pool, retryRunId, retryCommand), error =>
        error instanceof ConflictError && error.message === scenario.error);
      assert.equal(calls.at(-1)?.sql, 'rollback');
      assert.ok(calls.every(({ sql }) => !sql.startsWith('update') && !sql.startsWith('insert')));
    });
  }
});
