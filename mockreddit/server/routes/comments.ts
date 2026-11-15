import { Router } from 'express';
import { COMMUNITY } from '../../src/config';
import type { Db } from '../db';
import { ah, db, HttpError } from '../http';
import { requireSub, toUnix } from './shared';

interface PostRow {
  id: string; title: string; body: string; author: string; flair: string; score: number; created_at: string;
}
interface CommentRow {
  id: string; post_id: string; parent_id: string | null; author: string; body: string; score: number; created_at: string;
}

interface Listing<T> { kind: 'Listing'; data: { after: null; dist: number; children: T[] } }
interface T1 {
  kind: 't1';
  data: {
    id: string; name: string; parent_id: string; link_id: string; author: string; body: string;
    score: number; created_utc: number; replies: Listing<T1> | '';
  };
}

const listing = <T>(children: T[]): Listing<T> => ({ kind: 'Listing', data: { after: null, dist: children.length, children } });

/** Reddit order: highest score first, older first on ties. */
const byScore = (a: CommentRow, b: CommentRow) => b.score - a.score || a.created_at.localeCompare(b.created_at);

/** Build the nested t1 tree. Comments whose parent is missing become top level. */
export function commentTree(postId: string, rows: CommentRow[]): T1[] {
  const ids = new Set(rows.map((c) => c.id));
  const kids = new Map<string | null, CommentRow[]>();
  for (const c of rows) {
    const parent = c.parent_id && ids.has(c.parent_id) && c.parent_id !== c.id ? c.parent_id : null;
    kids.set(parent, [...(kids.get(parent) ?? []), c]);
  }

  const seen = new Set<string>();
  const build = (parent: string | null): T1[] =>
    (kids.get(parent) ?? [])
      .filter((c) => !seen.has(c.id) && seen.add(c.id))
      .sort(byScore)
      .map((c) => {
        const replies = build(c.id);
        return {
          kind: 't1',
          data: {
            id: c.id,
            name: `t1_${c.id}`,
            parent_id: c.parent_id && ids.has(c.parent_id) ? `t1_${c.parent_id}` : `t3_${postId}`,
            link_id: `t3_${postId}`,
            author: c.author,
            body: c.body,
            score: c.score,
            created_utc: toUnix(c.created_at),
            replies: replies.length ? listing(replies) : '',
          },
        };
      });

  return build(null);
}

/** GET /r/:sub/comments/:id.json → [postListing, commentsListing], like Reddit's post page. */
export function commentRoutes(database: Db) {
  const router = Router();

  router.get(
    '/r/:sub/comments/:id.json',
    ah(async (req, res) => {
      requireSub(req);
      const id = String(req.params.id);
      if (!/^[a-z0-9]{1,32}$/.test(id)) throw new HttpError(404, 'Not Found');

      const { data: post } = await db<PostRow>(
        database.from('posts').select('id, title, body, author, flair, score, created_at').eq('id', id).maybeSingle(),
      );
      if (!post) throw new HttpError(404, 'Not Found');

      const { data } = await db<CommentRow[]>(
        database
          .from('comments')
          .select('id, post_id, parent_id, author, body, score, created_at')
          .eq('post_id', id)
          .order('created_at', { ascending: true }),
      );
      const rows = data ?? [];

      // Same fields as a child of the listing endpoint, so one mapper handles both.
      const t3 = {
        kind: 't3',
        data: {
          id: post.id,
          name: `t3_${post.id}`,
          title: post.title,
          selftext: post.body,
          author: post.author,
          score: post.score,
          link_flair_text: post.flair,
          created_utc: toUnix(post.created_at),
          num_comments: rows.length,
          permalink: `/r/${COMMUNITY}/post/${post.id}`,
          subreddit: COMMUNITY,
          comments: rows.map((c) => ({
            id: c.id,
            name: `t1_${c.id}`,
            parent_id: c.parent_id ? `t1_${c.parent_id}` : `t3_${post.id}`,
            author: c.author,
            body: c.body,
            score: c.score,
            created_utc: toUnix(c.created_at),
          })),
        },
      };

      res.json([listing([t3]), listing(commentTree(post.id, rows))]);
    }),
  );

  return router;
}
