import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { authOf, identify, requireToken } from './auth';
import type { Db } from './db';
import { HttpError, sendProblem, UpstreamError } from './http';
import { rateLimit, type RateLimitOptions } from './rateLimit';
import { healthRoutes } from './routes/health';
import { searchRoutes } from './routes/search';
import { tweetRoutes } from './routes/tweets';

export interface AppOptions {
  db: Db;
  /** Valid bearer tokens (R_API_TOKENS). */
  tokens: string[];
  /** Serve the built SPA from here after the API routes (production). */
  staticDir?: string;
  rateLimit?: Partial<RateLimitOptions>;
  /** Express "trust proxy" setting, used to find the client IP for unauthenticated rate limiting. */
  trustProxy?: boolean | number | string;
  log?: (line: string) => void;
}

/** The developer API: /2/... (token required). /api/... is public (health). Everything else is the SPA. */
export const isV2Path = (p: string) => /^\/2(\/|$)/.test(p);
export const isApiPath = (p: string) => isV2Path(p) || /^\/api(\/|$)/.test(p);

const only =
  (test: (p: string) => boolean, mw: RequestHandler): RequestHandler =>
  (req, res, next) =>
    test(req.path) ? mw(req, res, next) : next();

const clean = (s: string | undefined, max = 200) => (s ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, max);

/** Log path + query, with any credential-looking query param blanked (tokens belong in the header). */
function safeUrl(originalUrl: string) {
  const [p, qs] = originalUrl.split('?', 2);
  if (!qs) return clean(p, 500);
  const params = new URLSearchParams(qs);
  for (const k of [...params.keys()]) {
    if (/token|key|auth|secret|bearer|password/i.test(k) && k !== 'next_token') params.set(k, 'REDACTED');
  }
  return clean(`${p}?${params.toString()}`, 500);
}

export function createApp(opts: AppOptions) {
  const log = opts.log ?? ((line: string) => console.log(line));
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', opts.trustProxy ?? 'loopback');
  app.set('query parser', 'simple');

  // One line per request. Only the token's first 4 characters are ever logged.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const { prefix } = authOf(res);
      const tok = prefix ? `${clean(prefix.slice(0, 4), 4)}…` : '-';
      log(`${req.method} ${safeUrl(req.originalUrl)} ${res.statusCode} ${ms.toFixed(1)}ms token=${tok}`);
    });
    next();
  });

  app.use(
    only(isApiPath, (_req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    }),
  );

  // /2/*: open CORS for GET (preflight answered before auth), then identify the token,
  // rate limit per token (or per IP without one), then reject missing or invalid tokens.
  app.use(only(isV2Path, cors({ origin: '*', methods: ['GET', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'] })));
  app.use(only(isV2Path, identify(opts.tokens)));
  app.use(only(isV2Path, rateLimit({ max: 180, windowMs: 15 * 60_000, ...opts.rateLimit })));
  app.use(only(isV2Path, requireToken));

  // search/recent must come before /2/tweets/:id.
  app.use(searchRoutes(opts.db));
  app.use(tweetRoutes(opts.db));
  app.use(healthRoutes(opts.db));
  app.use(only(isApiPath, (_req, res) => sendProblem(res, 404, 'Not Found')));

  // Production: the same process serves the site, so the API and the site share one URL.
  const index = opts.staticDir && path.join(opts.staticDir, 'index.html');
  if (opts.staticDir && index && fs.existsSync(index)) {
    app.use(express.static(opts.staticDir, { index: false }));
    app.get('*', (_req, res) => res.sendFile(index));
  }

  app.use((_req, res) => sendProblem(res, 404, 'Not Found'));

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) return sendProblem(res, err.status, err.detail);
    if (err instanceof UpstreamError) {
      log(`upstream error code=${clean(err.code, 40)}`);
      return sendProblem(res, 502, 'Bad Gateway');
    }
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) log(`internal error ${clean(err?.name)}: ${clean(err?.message)}`);
    return sendProblem(res, status);
  };
  app.use(onError);

  return app;
}
