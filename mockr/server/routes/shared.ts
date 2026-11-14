import type { z } from 'zod';
import type { Db } from '../db';
import { db, HttpError } from '../http';

/** Validate query params (unknown ones, like tweet.fields, are dropped). Bad input → 400 naming the param. */
export function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const parsed = schema.safeParse(query);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const param = issue?.path.join('.') || 'query';
  throw new HttpError(400, `Invalid "${param}" parameter: ${issue?.message ?? 'invalid value'}`);
}

export const DIGITS = /^\d{1,25}$/;

/** Look up the post a next_token points at (tokens are post ids). Unknown → 400. */
export async function cursorRow(database: Db, token: string) {
  const row = await db<{ id: string; created_at: string }>(
    database.from('posts').select('id, created_at').eq('id', token).maybeSingle(),
  );
  if (!row) throw new HttpError(400, 'Invalid "next_token" parameter: unknown token');
  return row;
}

/** Escape LIKE wildcards so user input matches literally. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
