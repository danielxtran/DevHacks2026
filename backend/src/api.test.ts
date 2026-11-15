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
