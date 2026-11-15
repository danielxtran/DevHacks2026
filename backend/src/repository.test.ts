import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { startNumericExperiment } from './repository.js';

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
