import type { RequestHandler } from 'express';
import { sendError } from './http';

export interface RateLimitOptions {
  /** Requests allowed per window, per IP. */
  max: number;
  windowMs: number;
  now?: () => number;
}

/**
 * Fixed-window, in-memory rate limit per client IP. Like Reddit, it sends
 * X-Ratelimit-Used / -Remaining / -Reset (seconds until the window resets) on every response.
 */
export function rateLimit({ max, windowMs, now = Date.now }: RateLimitOptions): RequestHandler {
  const windows = new Map<string, { used: number; resetAt: number }>();

  return (req, res, next) => {
    const t = now();
    if (windows.size > 10_000) {
      for (const [ip, w] of windows) if (w.resetAt <= t) windows.delete(ip);
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    let w = windows.get(ip);
    if (!w || w.resetAt <= t) {
      w = { used: 0, resetAt: t + windowMs };
      windows.set(ip, w);
    }
    w.used += 1;

    const reset = Math.max(0, Math.ceil((w.resetAt - t) / 1000));
    res.set({
      'X-Ratelimit-Used': String(Math.min(w.used, max)),
      'X-Ratelimit-Remaining': String(Math.max(0, max - w.used)),
      'X-Ratelimit-Reset': String(reset),
    });

    if (w.used > max) {
      res.set('Retry-After', String(reset));
      sendError(res, 429);
      return;
    }
    next();
  };
}
