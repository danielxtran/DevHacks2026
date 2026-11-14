// Reference fetcher for the collector: pages through the X-API-v2-shaped
// search_recent() RPC and maps each post to a feedback_posts row (see 0004_mockr.sql).
// It does NOT write to the database; the worker does the inserts.
// In the worker, use a client created with { db: { schema: 'mockr' } }.
import { supabase } from '../lib/supabase';

interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  conversation_id: string;
  public_metrics: { like_count: number; retweet_count: number; reply_count: number; quote_count: number };
  referenced_tweets: { type: 'replied_to'; id: string }[];
}

interface SearchResponse {
  data: Tweet[];
  includes: { users: { id: string; username: string; name: string }[] };
  meta: { result_count: number; newest_id?: string; oldest_id?: string; next_token?: string };
}

export interface FeedbackRow {
  id: string;
  external_id: string;
  source: 'r';
  fixture_set: 'mock-live';
  kind: 'post' | 'comment';
  parent_id: string | null;
  thread_id: string | null;
  title: null;
  body: string;
  score: number;
  author: string;
  posted_at: string;
}

const CAP = 500;

export async function fetchR(query: string | null = null): Promise<FeedbackRow[]> {
  const tweets: Tweet[] = [];
  let token: string | null = null;

  while (tweets.length < CAP) {
    const { data, error } = await supabase.rpc('search_recent', {
      p_query: query, p_max_results: 100, p_next_token: token,
    });
    if (error) throw error;
    const page = data as SearchResponse;
    tweets.push(...page.data);
    token = page.meta.next_token ?? null;
    if (!token) break;
  }

  const rows: FeedbackRow[] = tweets.slice(0, CAP).map((t) => ({
    id: `r_${t.id}`,
    external_id: t.id,
    source: 'r',
    fixture_set: 'mock-live',
    kind: t.referenced_tweets.length ? 'comment' : 'post',
    parent_id: t.referenced_tweets[0] ? `r_${t.referenced_tweets[0].id}` : null,
    thread_id: t.referenced_tweets.length ? `r_${t.conversation_id}` : null,
    title: null,
    body: t.text,
    score: t.public_metrics.like_count,
    author: t.author_id,
    posted_at: t.created_at,
  }));

  // Parents before replies: sort by depth in the reply tree, then oldest first.
  // (A reply whose parent fell outside the fetched window keeps depth 1; the
  // worker must skip it or fetch the parent, since parent_id is a foreign key.)
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depth = (r: FeedbackRow): number => {
    let d = 0;
    for (let cur: FeedbackRow | undefined = r; cur?.parent_id && d < 1000; cur = byId.get(cur.parent_id)) d++;
    return d;
  };
  return rows
    .map((r) => ({ r, d: depth(r) }))
    .sort((a, b) => a.d - b.d || a.r.posted_at.localeCompare(b.r.posted_at))
    .map(({ r }) => r);
}
