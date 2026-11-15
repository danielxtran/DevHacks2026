import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import type { Pool } from 'pg';
import type { ArtifactStore } from './artifact-store.js';
import { createApp } from './api.js';

const issueId = '11111111-1111-4111-8111-111111111111';

test('tracker read endpoints expose Discovery, real source counts, run identity, and ordered evidence', async (t) => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const issue = {
    id: issueId, title: 'Long stuns', summary: 'Players report lost actions.', category: 'feels_bad',
    tags: ['combat'], feedback_count: 2, source_counts: { reddit: 1, r: 1 },
    latest_run: { id: '22222222-2222-4222-8222-222222222222', stage: 'design', status: 'specing', decision: null },
  };
  const feedback = { id: 'r_123', source: 'r', body: 'Cannot act', numComments: null, parentId: 'r_122', threadId: 'r_120' };
  const source = { source: 'r', status: 'incomplete', truncated: true, completed_at: '2026-11-14T12:00:00Z' };
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes('from public.collection_sweeps')) return { rows: [source], rowCount: 1 };
      if (sql.includes('where i.id=$1')) return { rows: [{ ...issue, feedback: [feedback] }], rowCount: 1 };
      return { rows: [issue], rowCount: 1 };
    },
  } as unknown as Pool;
  const app = createApp({
    pool, artifacts: {} as ArtifactStore, baselineRevision: undefined, scenarios: [],
    sourceConfigured: true, discoveryConfigured: false,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  const board = await fetch(`${base}/issues`);
  assert.equal(board.status, 200);
  assert.equal(board.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await board.json(), { issues: [issue] });
  assert.match(calls[0]!.sql, /from public\.discovered_issues/);
  assert.match(calls[0]!.sql, /where r\.selected_issue_id=i\.id/);
  assert.match(calls[0]!.sql, /left join public\.human_decisions/);
  assert.match(calls[0]!.sql, /filter \(where f\.source='r'\)/);

  const detail = await fetch(`${base}/issues/${issueId}`);
  assert.equal(detail.status, 200);
  assert.deepEqual((await detail.json() as { issue: { feedback: unknown[] } }).issue.feedback, [feedback]);
  assert.deepEqual(calls[1]!.params, [issueId]);
  assert.match(calls[1]!.sql, /order by f\.posted_at, f\.id/);
  assert.match(calls[1]!.sql, /'numComments', f\.num_comments/);

  const sources = await fetch(`${base}/sources`);
  assert.deepEqual(await sources.json(), { sources: [source] });
  assert.match(calls[2]!.sql, /distinct on \(source\)/);
  assert.match(calls[2]!.sql, /started_at desc/);

  const invalid = await fetch(`${base}/issues/not-a-uuid`);
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 3);
});

test('run reads serialize PostgreSQL timestamps as ISO datetimes', async (t) => {
  const runId = '22222222-2222-4222-8222-222222222222';
  const createdAt = '2026-11-15T04:25:38.667244+00:00';
  const pool = {
    async query(sql: string) {
      assert.match(sql, /to_json\(r\.created_at\) as created_at/);
      return { rows: [{
        id: runId, status: 'failed', workflow_stage: 'spec_failed', error: null,
        baseline_revision: null, candidate_revision: null, created_at: createdAt,
      }], rowCount: 1 };
    },
  } as unknown as Pool;
  const server = createServer(createApp({
    pool, artifacts: {} as ArtifactStore, baselineRevision: undefined, scenarios: [],
    sourceConfigured: true, discoveryConfigured: false,
  }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/runs/${runId}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { run: { created_at: string } }).run.created_at, createdAt);
});

test('issue metadata command requires a saved revision and returns backend-owned values', async (t) => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const issue = {
    id: issueId, title: 'Long stuns', summary: 'Players report lost actions.', category: 'feels_bad',
    tags: ['combat'], triage_state: 'open', revision: 4, assigned_developer: null,
    human_title: null, human_tags: null,
  };
  const client = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (sql === 'begin' || sql === 'commit') return { rows: [], rowCount: 0 };
      if (sql.includes('from public.discovered_issues') && sql.includes('for update')) return { rows: [issue], rowCount: 1 };
      if (sql.includes('update public.discovered_issues')) return {
        rows: [{ ...issue, revision: 5, assigned_developer: 'jun', human_title: 'Stun lock' }], rowCount: 1,
      };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const app = createApp({
    pool, artifacts: {} as ArtifactStore, baselineRevision: undefined, scenarios: [],
    sourceConfigured: true, discoveryConfigured: false,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/issues/${issueId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 4, actor: 'Tony', developer: 'jun', title: 'Stun lock' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { issue: { ...issue, revision: 5, assigned_developer: 'jun', human_title: 'Stun lock' } });
  assert.deepEqual(calls[1]!.params, [issueId]);
  assert.ok(calls.some(({ sql }) => sql.includes('insert into public.issue_activity')));
});

test('spec retry validates intent and configuration before queueing the saved job', async t => {
  const runId = '22222222-2222-4222-8222-222222222222';
  const jobId = '33333333-3333-4333-8333-333333333333';
  let connections = 0;
  const client = {
    async query(sql: string) {
      if (sql.includes('from public.runs')) return { rows: [{ id: runId, selected_issue_id: issueId,
        experiment_kind: 'hexlab_numeric', lifecycle_phase: 'spec_failed', revision: 2, simulation_generation: 0 }], rowCount: 1 };
      if (sql.includes('from public.workflow_jobs') && sql.includes('last_retry_key')) return {
        rows: [{ id: jobId, state: 'failed', generation: 0, attempt: 1, error: 'Timed out' }], rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const options = {
    pool: { async connect() { connections++; return client; } } as unknown as Pool,
    artifacts: {} as ArtifactStore, baselineRevision: undefined, scenarios: [],
    sourceConfigured: true, discoveryConfigured: false, modelConfigured: false,
  };
  const server = createServer(createApp(options));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const retry = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/runs/${runId}/spec-retry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const body = { expectedRevision: 2, actor: 'You', idempotencyKey: 'retry-api' };
  assert.equal((await retry({ ...body, actor: '' })).status, 400);
  assert.equal((await retry(body)).status, 503);
  assert.equal(connections, 0);
  options.modelConfigured = true;
  const response = await retry(body);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { runId, jobId, status: 'queued' });
  assert.equal(connections, 1);
});

test('issue metadata command rejects unknown developer IDs before opening a transaction', async (t) => {
  let connections = 0;
  const pool = { async connect() { connections++; throw new Error('unexpected database access'); } } as unknown as Pool;
  const app = createApp({
    pool, artifacts: {} as ArtifactStore, baselineRevision: undefined, scenarios: [],
    sourceConfigured: true, discoveryConfigured: false,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/issues/${issueId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 4, actor: 'Tony', developer: 'unknown' }),
  });
  assert.equal(response.status, 400);
  assert.equal(connections, 0);
});
