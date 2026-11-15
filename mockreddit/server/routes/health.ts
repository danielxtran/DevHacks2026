import { Router } from 'express';
import { SITE_NAME } from '../../src/config';
import type { Db } from '../db';
import { ah, db, UpstreamError } from '../http';

const SERVICE = SITE_NAME.toLowerCase();

/** GET /api/health → 200 when Supabase answers a 1-post listing, 503 when it doesn't. */
export function healthRoutes(database: Db) {
  const router = Router();

  router.get(
    '/api/health',
    ah(async (_req, res) => {
      const time = new Date().toISOString();
      try {
        await db(database.rpc('listing', { p_sort: 'new', p_limit: 1, p_after: null }));
      } catch (err) {
        if (!(err instanceof UpstreamError)) throw err;
        res.status(503).json({ ok: false, service: SERVICE, time, message: 'Service Unavailable', error: 503 });
        return;
      }
      res.json({ ok: true, service: SERVICE, time });
    }),
  );

  return router;
}
