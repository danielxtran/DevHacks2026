import { Router } from 'express';
import type { Db } from '../db';
import { ah, db, UpstreamError } from '../http';

/** GET /api/health (public) → 200 when Supabase answers, 503 when it doesn't. */
export function healthRoutes(database: Db) {
  const router = Router();

  router.get(
    '/api/health',
    ah(async (_req, res) => {
      const time = new Date().toISOString();
      try {
        await db(database.from('posts').select('id').limit(1));
      } catch (err) {
        if (!(err instanceof UpstreamError)) throw err;
        res.status(503).json({ ok: false, service: 'r', time, title: 'Service Unavailable', type: 'about:blank', status: 503, detail: 'Service Unavailable' });
        return;
      }
      res.json({ ok: true, service: 'r', time });
    }),
  );

  return router;
}
