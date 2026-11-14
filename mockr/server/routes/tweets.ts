import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db';
import { ah, db, HttpError } from '../http';
import { notFound, POST_COLUMNS, toTweet, usersOf, type PostRow } from '../tweets';
import { DIGITS, parseQuery } from './shared';

const IDS_MSG = 'must be 1 to 100 comma-separated numeric ids';
const lookupQuery = z.object({
  ids: z
    .string({ required_error: 'is required' })
    .transform((s) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))])
    .refine((ids) => ids.length >= 1 && ids.length <= 100 && ids.every((id) => DIGITS.test(id)), IDS_MSG),
});

async function lookup(database: Db, ids: string[]) {
  const rows = (await db<PostRow[]>(database.from('posts').select(POST_COLUMNS).in('id', ids))) ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const found = ids.map((id) => byId.get(id)).filter((r): r is PostRow => !!r);
  const missing = ids.filter((id) => !byId.has(id));
  return { found, missing };
}

/** GET /2/tweets/:id and GET /2/tweets?ids=1,2,3 */
export function tweetRoutes(database: Db) {
  const router = Router();

  router.get(
    '/2/tweets',
    ah(async (req, res) => {
      const { ids } = parseQuery(lookupQuery, req.query);
      const { found, missing } = await lookup(database, ids);
      res.json({
        ...(found.length ? { data: found.map(toTweet), includes: { users: usersOf(found) } } : {}),
        ...(missing.length ? { errors: missing.map(notFound) } : {}),
      });
    }),
  );

  router.get(
    '/2/tweets/:id',
    ah(async (req, res) => {
      const id = String(req.params.id);
      if (!DIGITS.test(id)) throw new HttpError(400, 'Invalid "id" parameter: must be digits');
      const { found } = await lookup(database, [id]);
      // Unknown id → 200 with an errors array, the way X does it.
      if (!found.length) {
        res.json({ errors: [notFound(id)] });
        return;
      }
      res.json({ data: toTweet(found[0]), includes: { users: usersOf(found) } });
    }),
  );

  return router;
}
