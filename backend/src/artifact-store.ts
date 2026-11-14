import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Pool } from 'pg';
import { ArtifactSchema } from './contracts.js';

export class ArtifactStore {
  private readonly root: string;
  constructor(private readonly pool: Pool, directory: string) {
    this.root = resolve(directory);
  }

  async save(runId: string | null, kind: string, contents: string | Buffer, mediaType = 'application/json', logicalPath: string | null = null): Promise<unknown> {
    const id = randomUUID();
    const bucket = runId ?? 'unattached';
    const relativePath = `${bucket}/${id}.artifact`;
    const filePath = resolve(this.root, relativePath);
    if (isAbsolute(relative(this.root, filePath)) || relative(this.root, filePath).startsWith(`..${sep}`)) {
      throw new Error('Invalid artifact path.');
    }
    const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
    try {
      const result = await this.pool.query(
        `insert into public.artifacts (id,run_id,kind,relative_path,media_type,sha256,size_bytes,logical_path)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id,run_id,kind,logical_path,media_type,sha256,size_bytes,created_at::text as created_at`,
        [id, runId, kind, relativePath, mediaType, createHash('sha256').update(bytes).digest('hex'), bytes.length, logicalPath],
      );
      return ArtifactSchema.parse(result.rows[0]);
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }

  async list(runId: string): Promise<unknown[]> {
    const result = await this.pool.query(
      `select id,run_id,kind,logical_path,media_type,sha256,size_bytes,created_at::text as created_at
       from public.artifacts where run_id=$1 order by created_at,id`, [runId],
    );
    return result.rows.map((row) => ArtifactSchema.parse(row));
  }

  async read(id: string): Promise<{ meta: unknown; contents: Buffer }> {
    const result = await this.pool.query(
      `select id,run_id,kind,relative_path,logical_path,media_type,sha256,size_bytes,created_at::text as created_at
       from public.artifacts where id=$1`, [id],
    );
    const row = result.rows[0];
    if (!row) throw new Error('artifact_not_found');
    const filePath = resolve(this.root, row.relative_path as string);
    const rel = relative(this.root, filePath);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('invalid_artifact_path');
    const [rootReal, fileReal] = await Promise.all([realpath(this.root), realpath(filePath)]);
    if (!fileReal.startsWith(`${rootReal}${sep}`)) throw new Error('invalid_artifact_path');
    const contents = await readFile(fileReal);
    const sha256 = createHash('sha256').update(contents).digest('hex');
    if (contents.length !== Number(row.size_bytes) || sha256 !== row.sha256) throw new Error('artifact_integrity_error');
    const { relative_path: _path, ...meta } = row;
    return { meta: ArtifactSchema.parse(meta), contents };
  }
}
