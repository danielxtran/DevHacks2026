import type { RequestHandler } from 'express';
import { sendProblem } from './http';

export interface RateLimitOptions {
  /** Requests allowed per window, per client IP. */
  max: number;
  windowMs: number;
  now?: () => number;
}

/**
 * Fixed-window, in-memory rate limit per client IP.
 * Like X, it sends x-rate-limit-limit / -remaining / -reset (unix seconds) on every response.
 */
export function rateLimit({ max, windowMs, now = Date.now }: RateLimitOptions): RequestHandler {
  const windows = new Map<string, { used: number; resetAt: number }>();

  return (req, res, next) => {
    const t = now();
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
    }

    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let w = windows.get(key);
    if (!w || w.resetAt <= t) {
      w = { used: 0, resetAt: t + windowMs };
      windows.set(key, w);
    }
    w.used += 1;

    res.set({
      'x-rate-limit-limit': String(max),
      'x-rate-limit-remaining': String(Math.max(0, max - w.used)),
      'x-rate-limit-reset': String(Math.ceil(w.resetAt / 1000)),
    });

    if (w.used > max) {
      res.set('Retry-After', String(Math.max(0, Math.ceil((w.resetAt - t) / 1000))));
      sendProblem(res, 429, 'Too Many Requests');
      return;
    }
    next();
  };
}
