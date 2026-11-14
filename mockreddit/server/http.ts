import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** An error with an HTTP status that is safe to show to API clients. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Supabase failed or was unreachable. The response never includes the original error,
 * because it could expose internals. Only a short code is logged.
 */
export class UpstreamError extends Error {
  constructor(public code: string) {
    super('upstream error');
  }
}

export const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

export function sendError(res: Response, status: number, message = STATUS_TEXT[status] ?? 'Error') {
  res.status(status).json({ message, error: status });
}

/** Express 4 doesn't catch rejected promises, so forward them to the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

interface DbResult<T> {
  data: T | null;
  error: { code?: string; message?: string } | null;
  count?: number | null;
}

/** Await a supabase-js call and turn any failure (thrown or returned) into an UpstreamError. */
export async function db<T>(query: PromiseLike<DbResult<T>>): Promise<{ data: T | null; count: number | null }> {
  let result: DbResult<T>;
  try {
    result = await query;
  } catch {
    throw new UpstreamError('network');
  }
  if (result.error) throw new UpstreamError(result.error.code || 'unknown');
  return { data: result.data, count: result.count ?? null };
}
