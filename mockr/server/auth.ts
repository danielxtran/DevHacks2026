import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { sendProblem } from './http';

/** What the auth middleware learned about the caller. Never holds the token itself. */
export interface AuthInfo {
  /** Index into the configured token list, or null when the token is missing or invalid. */
  tokenIndex: number | null;
  /** First 4 chars of whatever was presented, plus "…", for logs only. */
  prefix: string | null;
}

export const authOf = (res: Response): AuthInfo => res.locals.auth ?? { tokenIndex: null, prefix: null };

/** Parse R_API_TOKENS: comma-separated, trimmed, empty entries dropped. */
export function parseTokens(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export const tokenPrefix = (token: string) => `${token.slice(0, 4)}…`;

/** Constant-time match of `presented` against every configured token (no early exit). */
export function matchToken(presented: string, tokens: Buffer[]): number | null {
  const p = Buffer.from(presented, 'utf8');
  let found: number | null = null;
  tokens.forEach((t, i) => {
    // timingSafeEqual throws on different lengths, so check length first.
    if (t.length === p.length && timingSafeEqual(t, p) && found === null) found = i;
  });
  return found;
}

/**
 * Reads `Authorization: Bearer <token>` and records the result in res.locals.auth.
 * It doesn't reject anything by itself, so the rate limiter can count unauthenticated callers per IP first.
 */
export function identify(tokens: string[]): RequestHandler {
  const buffers = tokens.map((t) => Buffer.from(t, 'utf8'));
  return (req, res, next) => {
    const header = req.get('authorization') ?? '';
    const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
    const presented = m?.[1] ?? null;
    const info: AuthInfo = {
      tokenIndex: presented ? matchToken(presented, buffers) : null,
      prefix: presented ? tokenPrefix(presented) : null,
    };
    res.locals.auth = info;
    next();
  };
}

/** 401 unless identify() matched a configured token. */
export const requireToken: RequestHandler = (_req, res, next) => {
  if (authOf(res).tokenIndex === null) {
    res.set('WWW-Authenticate', 'Bearer');
    sendProblem(res, 401, 'Unauthorized');
    return;
  }
  next();
};
