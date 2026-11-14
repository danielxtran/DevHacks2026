import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db';
import { ah, db, HttpError } from '../http';
import { EMPTY, POST_COLUMNS, toSearchResponse, type PostRow, type SearchResponse } from '../tweets';
import { cursorRow, DIGITS, escapeLike, parseQuery } from './shared';

const MAX_MSG = 'must be an integer from 10 to 100';
const searchQuery = z.object({
  query: z
    .string({ required_error: 'is required' })
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'must be 1 to 512 characters').max(512, 'must be 1 to 512 characters')),
  max_results: z
    .string()
    .regex(/^\d{1,3}$/, MAX_MSG)
    .transform(Number)
    .refine((n) => n >= 10 && n <= 100, MAX_MSG)
    .optional(),
  next_token: z.string().regex(DIGITS, 'must be digits').optional(),
});

type Parsed =
  | { kind: 'text'; text: string | null }
  | { kind: 'conversation'; id: string }
  | { kind: 'from'; username: string };

/** The supported query subset: text / #hashtag, `*`, `conversation_id:<id>`, `from:<username>`. */
export function parseSearch(q: string): Parsed {
  if (q === '*') return { kind: 'text', text: null };
  const op = /^(conversation_id|from):(.*)$/i.exec(q);
  if (!op) return { kind: 'text', text: q };

  const [, name, value] = op;
  if (name.toLowerCase() === 'conversation_id') {
    if (!DIGITS.test(value)) throw new HttpError(400, 'Invalid "query" parameter: conversation_id must be digits');
    return { kind: 'conversation', id: value };
  }
  const user = value.replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,50}$/.test(user)) throw new HttpError(400, 'Invalid "query" parameter: from: needs a username');
  return { kind: 'from', username: user };
}

/** GET /2/tweets/search/recent */
export function searchRoutes(database: Db) {
  const router = Router();

  router.get(
    '/2/tweets/search/recent',
    ah(async (req, res) => {
      const { query, max_results: limit = 10, next_token } = parseQuery(searchQuery, req.query);
      const parsed = parseSearch(query);
      const cursor = next_token ? await cursorRow(database, next_token) : null;

      // Text, hashtag and * go to the RPC, whose JSON is already X-shaped.
      if (parsed.kind === 'text') {
        const out = await db<SearchResponse>(
          database.rpc('search_recent', { p_query: parsed.text, p_max_results: limit, p_next_token: cursor?.id ?? null }),
        );
        res.json(out?.data?.length ? out : EMPTY);
        return;
      }

      // conversation_id: and from: are direct selects, newest first, shaped exactly like the RPC.
      let q = database.from('posts').select(POST_COLUMNS);
      q = parsed.kind === 'conversation' ? q.eq('conversation_id', parsed.id) : q.ilike('author_username', escapeLike(parsed.username));
      if (cursor) {
        // Same keyset as the RPC: (created_at, id) < cursor.
        const ts = `"${cursor.created_at}"`;
        q = q.or(`created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${cursor.id})`);
      }
      const rows = await db<PostRow[]>(
        q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit),
      );
      res.json(toSearchResponse(rows ?? [], limit));
    }),
  );

  return router;
}
