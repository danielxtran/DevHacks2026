import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db';
import { ah, db, HttpError } from '../http';
import { parseQuery, requireSub } from './shared';

export const SORTS = ['new', 'hot', 'top'] as const;
type Sort = (typeof SORTS)[number];

const LIMIT_MSG = 'must be an integer from 1 to 100';
const listingQuery = z.object({
  limit: z
    .string()
    .regex(/^\d{1,3}$/, LIMIT_MSG)
    .transform(Number)
    .refine((n) => n >= 1 && n <= 100, LIMIT_MSG)
    .optional(),
  after: z.string().regex(/^t3_[a-z0-9]+$/, 'must look like t3_<post id>').optional(),
});

/** GET /r/:sub/{new,hot,top}.json → the listing() RPC's Reddit-shaped Listing, as-is. */
export function listingRoutes(database: Db) {
  const router = Router();

  router.get(
    '/r/:sub/:sort.json',
    ah(async (req, res) => {
      requireSub(req);
      const sort = req.params.sort as Sort;
      if (!SORTS.includes(sort)) throw new HttpError(404, 'Not Found');
      const { limit = 25, after } = parseQuery(listingQuery, req.query);

      const { data } = await db(
        database.rpc('listing', { p_sort: sort, p_limit: limit, p_after: after ?? null }),
      );
      res.json(data);
    }),
  );

  return router;
}
