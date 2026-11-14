// One place that turns mockr.posts rows into X API v2 shapes, so every endpoint returns identical fields.
// It matches what the search_recent() RPC in 0004_mockr.sql builds.

export const POST_COLUMNS =
  'id, author_username, author_name, body, reply_to_id, conversation_id, like_count, repost_count, reply_count, created_at';

export interface PostRow {
  id: string;
  author_username: string;
  author_name: string;
  body: string;
  reply_to_id: string | null;
  conversation_id: string;
  like_count: number;
  repost_count: number;
  reply_count: number;
  created_at: string;
}

export interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  conversation_id: string;
  public_metrics: { like_count: number; retweet_count: number; reply_count: number; quote_count: number };
  referenced_tweets: { type: 'replied_to'; id: string }[];
}

export interface User {
  id: string;
  username: string;
  name: string;
}

export interface SearchResponse {
  data?: Tweet[];
  includes?: { users: User[] };
  meta: { result_count: number; newest_id?: string; oldest_id?: string; next_token?: string };
}

export function toTweet(row: PostRow): Tweet {
  return {
    id: row.id,
    text: row.body,
    author_id: row.author_username,
    created_at: new Date(row.created_at).toISOString(), // ISO with ms + Z, like the RPC
    conversation_id: row.conversation_id,
    public_metrics: {
      like_count: row.like_count,
      retweet_count: row.repost_count,
      reply_count: row.reply_count,
      quote_count: 0,
    },
    referenced_tweets: row.reply_to_id ? [{ type: 'replied_to', id: row.reply_to_id }] : [],
  };
}

export function toUser(row: PostRow): User {
  return { id: row.author_username, username: row.author_username, name: row.author_name };
}

/** Unique authors of the given rows, in first-seen order. */
export function usersOf(rows: PostRow[]): User[] {
  const seen = new Map<string, User>();
  for (const r of rows) if (!seen.has(r.author_username)) seen.set(r.author_username, toUser(r));
  return [...seen.values()];
}

/** X omits `data` (and `includes`) entirely when nothing matched. */
export const EMPTY: SearchResponse = { meta: { result_count: 0 } };

/** Shape a page of rows (already newest first) exactly like the search_recent RPC. */
export function toSearchResponse(rows: PostRow[], limit: number): SearchResponse {
  if (rows.length === 0) return EMPTY;
  const meta: SearchResponse['meta'] = {
    result_count: rows.length,
    newest_id: rows[0].id,
    oldest_id: rows[rows.length - 1].id,
  };
  if (rows.length === limit) meta.next_token = rows[rows.length - 1].id;
  return { data: rows.map(toTweet), includes: { users: usersOf(rows) }, meta };
}

/** X-style "not found" entry for a missing tweet id. */
export function notFound(id: string) {
  return {
    value: id,
    detail: `Could not find tweet with id: [${id}].`,
    title: 'Not Found Error',
    resource_type: 'tweet',
    parameter: 'id',
    resource_id: id,
    type: 'about:blank',
  };
}
