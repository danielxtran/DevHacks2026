import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import type { Db } from './db';
import { HttpError, sendError, UpstreamError } from './http';
import { rateLimit, type RateLimitOptions } from './rateLimit';
import { aboutRoutes } from './routes/about';
import { commentRoutes } from './routes/comments';
import { healthRoutes } from './routes/health';
import { listingRoutes } from './routes/listing';

export interface AppOptions {
  db: Db;
  /** Serve the built SPA from here after the API routes (production). */
  staticDir?: string;
  rateLimit?: Partial<RateLimitOptions>;
  /** Express "trust proxy" setting, used to find the client IP for rate limiting. */
  trustProxy?: boolean | number | string;
  log?: (line: string) => void;
}

/** API paths: /api/... and any /r/<sub>/....json. Everything else belongs to the SPA. */
export const isApiPath = (p: string) => /^\/api(\/|$)/.test(p) || /^\/r\/[^/]+\/.+\.json$/.test(p);

const onlyApi =
  (mw: RequestHandler): RequestHandler =>
  (req, res, next) =>
    isApiPath(req.path) ? mw(req, res, next) : next();

const clean = (s: string | undefined, max = 200) => (s ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, max);

export function createApp(opts: AppOptions) {
  const log = opts.log ?? ((line: string) => console.log(line));
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', opts.trustProxy ?? 'loopback');
  app.set('query parser', 'simple');

  // One line per request. The User-Agent is logged but never required.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      log(`${req.method} ${clean(req.originalUrl, 500)} ${res.statusCode} ${ms.toFixed(1)}ms ua="${clean(req.get('user-agent')) || '-'}"`);
    });
    next();
  });

  // API-only behaviour: open CORS for GET, no caching (live posts must show up immediately), rate limit.
  app.use(onlyApi(cors({ origin: '*', methods: ['GET', 'OPTIONS'] })));
  app.use(
    onlyApi((_req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    }),
  );
  app.use(onlyApi(rateLimit({ max: 60, windowMs: 60_000, ...opts.rateLimit })));

  // about.json must come before /r/:sub/:sort.json, which would otherwise match it.
  app.use(aboutRoutes(opts.db));
  app.use(commentRoutes(opts.db));
  app.use(listingRoutes(opts.db));
  app.use(healthRoutes(opts.db));
  app.use(onlyApi((_req, res) => sendError(res, 404)));

  // Production: the same process serves the site, so the API and the site share one URL.
  const index = opts.staticDir && path.join(opts.staticDir, 'index.html');
  if (opts.staticDir && index && fs.existsSync(index)) {
    app.use(express.static(opts.staticDir, { index: false }));
    app.get('*', (_req, res) => res.sendFile(index));
  }

  app.use((_req, res) => sendError(res, 404));

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) return sendError(res, err.status, err.message);
    if (err instanceof UpstreamError) {
      log(`upstream error code=${clean(err.code, 40)}`);
      return sendError(res, 502);
    }
    // Body-parser style errors (none today, but keep a sane status if one appears).
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) log(`internal error ${clean(err?.name)}: ${clean(err?.message)}`);
    return sendError(res, status);
  };
  app.use(onError);

  return app;
}
