import { Router } from 'express';
import { COMMUNITY, COMMUNITY_TAGLINE, SITE_NAME } from '../../src/config';
import type { Db } from '../db';
import { ah, db } from '../http';
import { requireSub, toUnix } from './shared';

/** GET /r/:sub/about.json → a t5 (subreddit) object. */
export function aboutRoutes(database: Db) {
  const router = Router();

  router.get(
    '/r/:sub/about.json',
    ah(async (req, res) => {
      requireSub(req);
      // One query: the total post count plus the oldest post (used as the community's creation time).
      const { data, count } = await db<{ created_at: string }[]>(
        database.from('posts').select('created_at', { count: 'exact' }).order('created_at', { ascending: true }).limit(1),
      );
      const oldest = data?.[0]?.created_at;

      res.json({
        kind: 't5',
        data: {
          display_name: COMMUNITY,
          display_name_prefixed: `r/${COMMUNITY}`,
          title: `${SITE_NAME} · r/${COMMUNITY}`,
          public_description: COMMUNITY_TAGLINE,
          subscribers: count ?? 0,
          created_utc: oldest ? toUnix(oldest) : Math.floor(Date.now() / 1000),
          url: `/r/${COMMUNITY}/`,
        },
      });
    }),
  );

  return router;
}
