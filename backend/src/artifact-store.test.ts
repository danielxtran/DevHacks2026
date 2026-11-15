import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Pool } from 'pg';
import { ArtifactStore } from './artifact-store.js';

test('artifact save, list and read preserve ISO timestamps and readable content', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'devhacks-artifact-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const createdAt = '2026-11-15T04:25:38.667244+00:00';
  let saved: Record<string, unknown>;
  const pool = {
    async query(sql: string, params: unknown[]) {
      assert.match(sql, /to_json\(created_at\) as created_at/);
      if (sql.includes('insert into public.artifacts')) {
        const [id, run_id, kind, relative_path, media_type, sha256, size_bytes, logical_path] = params;
        saved = { id, run_id, kind, relative_path, media_type, sha256, size_bytes, logical_path, created_at: createdAt };
      }
      const { relative_path, ...meta } = saved;
      return { rows: [sql.includes('relative_path') && !sql.includes('insert into') ? { ...meta, relative_path } : meta], rowCount: 1 };
    },
  } as unknown as Pool;
  const store = new ArtifactStore(pool, directory);
  const runId = '22222222-2222-4222-8222-222222222222';
  const result = await store.save(runId, 'design', '{"proposal":"test"}') as { id: string; created_at: string };
  assert.equal(result.created_at, createdAt);
  assert.deepEqual(await store.list(runId), [result]);
  const read = await store.read(result.id);
  assert.deepEqual(read.meta, result);
  assert.equal(read.contents.toString(), '{"proposal":"test"}');
});
