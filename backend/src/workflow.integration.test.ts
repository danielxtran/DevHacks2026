import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('selected-run creation is atomic, snapshots evidence, and reuses only a matching idempotency key', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const token = randomUUID();
  const issueId = randomUUID();
  const postId = `test_${token}`;
  const scenarios = [1, 2, 3].map((seed) => ({ id: `fixture-${seed}`, seed, provenance: 'fixture', input: { seed } }));
  try {
    await client.query('begin');
    await client.query(
      `insert into public.feedback_posts (id,fixture_set,source,author,body,score,kind,title,external_id)
       values ($1,'mock-live','reddit','tester','Observed complaint',1,'post','Test','t3_test')`, [postId],
    );
    await client.query(
      `insert into public.discovered_issues (id,fingerprint,title,summary,category)
       values ($1,$2,'Test complaint','Saved summary','other')`, [issueId, token],
    );
    await client.query('insert into public.discovered_issue_memberships (issue_id,feedback_id) values ($1,$2)', [issueId, postId]);

    const first = await client.query<{ id: string }>(
      'select public.start_selected_run($1,$2,$3,$4::jsonb) as id',
      [issueId, `key-${token}`, 'base-revision-1', JSON.stringify(scenarios)],
    );
    const repeated = await client.query<{ id: string }>(
      'select public.start_selected_run($1,$2,$3,$4::jsonb) as id',
      [issueId, `key-${token}`, 'base-revision-1', JSON.stringify(scenarios)],
    );
    assert.equal(repeated.rows[0]?.id, first.rows[0]?.id);
    const snapshot = await client.query<{ body: string }>(
      `select payload->>'body' as body from public.run_feedback_snapshots where run_id=$1`, [first.rows[0]?.id],
    );
    assert.equal(snapshot.rows[0]?.body, 'Observed complaint');

    await client.query('savepoint mismatch');
    await assert.rejects(client.query(
      'select public.start_selected_run($1,$2,$3,$4::jsonb)',
      [issueId, `key-${token}`, 'different-revision', JSON.stringify(scenarios)],
    ));
    await client.query('rollback to savepoint mismatch');

    await client.query('savepoint concurrent');
    await assert.rejects(client.query(
      'select public.start_selected_run($1,$2,$3,$4::jsonb)',
      [issueId, `second-${token}`, 'base-revision-1', JSON.stringify(scenarios)],
    ));
    await client.query('rollback to savepoint concurrent');
    await client.query('rollback');
  } finally {
    client.release();
    await pool.end();
  }
});
