import type { Request } from 'express';
import type { z } from 'zod';
import { COMMUNITY } from '../../src/config';
import { HttpError } from '../http';

/** Only r/PatchworkTFT exists. The name is case-insensitive, like Reddit. */
export function requireSub(req: Request) {
  if (String(req.params.sub).toLowerCase() !== COMMUNITY.toLowerCase()) throw new HttpError(404, 'Not Found');
}

/** Validate query params (unknown params are dropped). Bad input → 400 naming the param. */
export function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const parsed = schema.safeParse(query);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const param = issue?.path.join('.') || 'query';
  throw new HttpError(400, `Invalid query parameter "${param}": ${issue?.message ?? 'invalid value'}`);
}

export const toUnix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
