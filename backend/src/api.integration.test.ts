import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import { ArtifactStore } from './artifact-store.js';
import { createApp } from './api.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('workflow HTTP starts one idempotent snapshot and serves only opaque artifact IDs', { skip: !databaseUrl }, async (t) => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const token = randomUUID();
  const issueId = randomUUID();
  const postId = `test_${token}`;
  const scenarios = [1, 2, 3].map((seed) => ({ id: `fixture-${seed}`, seed, provenance: 'fixture', input: { seed } }));
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'workflow-artifacts-'));
  const artifacts = new ArtifactStore(pool, artifactDirectory);
  const app = createApp({ pool, artifacts, baselineRevision: 'base-revision', scenarios, sourceConfigured: true, discoveryConfigured: false });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let runId = '';
  let artifactId = '';

  try {
    const active = await pool.query("select 1 from public.runs where selected_issue_id is not null and status::text not in ('done','failed','review')");
    if (active.rowCount) return t.skip('an active workflow run already exists');
    await pool.query(
      `insert into public.feedback_posts (id,fixture_set,source,author,body,score,kind,title,external_id)
       values ($1,'mock-live','reddit','tester','Frozen evidence',1,'post','Frozen title',$2)`, [postId, `t3_${token}`],
    );
    await pool.query(
      `insert into public.discovered_issues (id,fingerprint,title,summary,category)
       values ($1,$2,'HTTP issue','HTTP summary','other')`, [issueId, token],
    );
    await pool.query('insert into public.discovered_issue_memberships (issue_id,feedback_id) values ($1,$2)', [issueId, postId]);

    const start = async () => fetch(`${baseUrl}/issues/${issueId}/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: `request-${token}` }),
    });
    const firstResponse = await start();
    assert.equal(firstResponse.status, 202);
    const first = await firstResponse.json() as { run: { id: string; status: string } };
    runId = first.run.id;
    assert.equal(first.run.status, 'queued');
    const secondResponse = await start();
    const second = await secondResponse.json() as { run: { id: string } };
    assert.equal(secondResponse.status, 202);
    assert.equal(second.run.id, runId);

    await pool.query("update public.feedback_posts set body='Changed after selection' where id=$1", [postId]);
    const snapshot = await pool.query<{ body: string }>(
      `select payload->>'body' as body from public.run_feedback_snapshots where run_id=$1`, [runId],
    );
    assert.equal(snapshot.rows[0]?.body, 'Frozen evidence');
    const runResponse = await fetch(`${baseUrl}/runs/${runId}`);
    assert.equal(runResponse.status, 200);
    const runBody = await runResponse.json() as { run: { id: string }; stages: Array<{ stage: string }> };
    assert.equal(runBody.run.id, runId);
    assert.equal(runBody.stages[0]?.stage, 'baseline');

    const artifact = await artifacts.save(runId, 'source_evidence', '{"safe":true}');
    artifactId = (artifact as { id: string }).id;
    const artifactResponse = await fetch(`${baseUrl}/artifacts/${artifactId}`);
    assert.equal(artifactResponse.status, 200);
    assert.deepEqual(await artifactResponse.json(), { safe: true });
    assert.equal((await fetch(`${baseUrl}/artifacts/${randomUUID()}`)).status, 404);
  } finally {
    if (runId) await pool.query('delete from public.runs where id=$1', [runId]);
    await pool.query('delete from public.discovered_issues where id=$1', [issueId]);
    await pool.query('delete from public.feedback_posts where id=$1', [postId]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});
