import { createHash } from 'node:crypto';
import { FeedbackSchema, RedditListingSchema, RSearchSchema, type Feedback } from './contracts.js';

export interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface SourceSweep<T> {
  source: 'reddit' | 'r';
  items: T[];
  pages: number;
  truncated: boolean;
}

function contentFingerprint(row: Omit<Feedback, 'content_fingerprint'> | Feedback): string {
  const { score: _score, num_comments: _numComments, ...substantive } = row;
  return createHash('sha256').update(JSON.stringify(substantive)).digest('hex');
}

function parentFirst(rows: Feedback[]): Feedback[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const depth = (row: Feedback, visited = new Set<string>()): number => {
    if (!row.parent_id || !byId.has(row.parent_id)) return 0;
    if (visited.has(row.id)) throw new Error(`Feedback parent cycle at ${row.id}`);
    visited.add(row.id);
    return 1 + depth(byId.get(row.parent_id)!, visited);
  };
  return [...rows].sort((a, b) => depth(a) - depth(b) || a.posted_at.localeCompare(b.posted_at));
}

function validatedFeedback(row: unknown): Feedback {
  const result = FeedbackSchema.safeParse(row);
  if (!result.success) throw new Error(`Invalid normalized feedback: ${result.error.message}`);
  return result.data;
}

export async function fetchReddit(client: RpcClient, maxPosts = 1000): Promise<SourceSweep<Feedback>> {
  const posts: Array<ReturnType<typeof RedditListingSchema.parse>['data']['children'][number]['data']> = [];
  const cursors = new Set<string>();
  let after: string | null = null;
  let pages = 0;
  let truncated = false;

  while (posts.length < maxPosts) {
    const { data, error } = await client.rpc('listing', {
      p_sort: 'new', p_limit: Math.min(100, maxPosts - posts.length), p_after: after,
    });
    if (error) throw new Error(`mockreddit.listing failed: ${error.message}`);
    const page = RedditListingSchema.parse(data);
    pages++;
    posts.push(...page.data.children.map(({ data: post }) => post));
    after = page.data.after;
    if (!after) break;
    if (cursors.has(after)) throw new Error(`mockreddit.listing repeated cursor ${after}`);
    cursors.add(after);
    if (posts.length >= maxPosts) truncated = true;
  }

  const rows: Feedback[] = [];
  for (const post of posts.slice(0, maxPosts)) {
    const rootId = `mr_${post.id}`;
    const permalink = new URL(post.permalink, 'http://127.0.0.1:5174').toString();
    rows.push(validatedFeedback({
      id: rootId, external_id: post.name, source: 'reddit', fixture_set: 'mock-live', kind: 'post',
      parent_id: null, thread_id: null, title: post.title, body: post.selftext, score: post.score,
      author: post.author, posted_at: new Date(post.created_utc * 1000).toISOString(),
      num_comments: post.num_comments, source_url: permalink,
    }));
    for (const comment of post.comments) {
      const parentSourceId = comment.parent_id.replace(/^t[13]_/, '');
      rows.push(validatedFeedback({
        id: `mr_${comment.id}`, external_id: comment.name, source: 'reddit', fixture_set: 'mock-live', kind: 'comment',
        parent_id: `mr_${parentSourceId}`, thread_id: rootId, title: null, body: comment.body,
        score: comment.score, author: comment.author, posted_at: new Date(comment.created_utc * 1000).toISOString(),
        num_comments: null, source_url: `${permalink}#${comment.id}`,
      }));
    }
  }
  return { source: 'reddit', items: parentFirst(rows), pages, truncated };
}

export async function fetchR(client: RpcClient, maxPosts = 500): Promise<SourceSweep<Feedback>> {
  const tweets: Array<ReturnType<typeof RSearchSchema.parse>['data'][number]> = [];
  const authors = new Map<string, string>();
  const cursors = new Set<string>();
  let token: string | null = null;
  let pages = 0;
  let truncated = false;

  while (tweets.length < maxPosts) {
    const { data, error } = await client.rpc('search_recent', {
      p_query: null, p_max_results: 100, p_next_token: token,
    });
    if (error) throw new Error(`mockr.search_recent failed: ${error.message}`);
    const page = RSearchSchema.parse(data);
    pages++;
    for (const author of page.includes.users) authors.set(author.id, author.username || author.name);
    tweets.push(...page.data);
    token = page.meta.next_token ?? null;
    if (!token) break;
    if (cursors.has(token)) throw new Error(`mockr.search_recent repeated cursor ${token}`);
    cursors.add(token);
    if (tweets.length >= maxPosts) truncated = true;
  }

  const rows = tweets.slice(0, maxPosts).map((tweet) => {
    const root = tweet.referenced_tweets.length === 0;
    const parentId = tweet.referenced_tweets[0]?.id;
    const id = `r_${tweet.id}`;
    return validatedFeedback({
      id, external_id: tweet.id, source: 'r', fixture_set: 'mock-live', kind: root ? 'post' : 'comment',
      parent_id: parentId ? `r_${parentId}` : null,
      thread_id: root ? null : `r_${tweet.conversation_id}`,
      title: null, body: tweet.text, score: tweet.public_metrics.like_count,
      author: authors.get(tweet.author_id) ?? tweet.author_id, posted_at: tweet.created_at,
      num_comments: root ? tweet.public_metrics.reply_count : null,
      source_url: new URL(`/post/${tweet.id}`, 'http://127.0.0.1:5175').toString(),
    });
  });
  return { source: 'r', items: parentFirst(rows), pages, truncated };
}

export function fingerprintFeedback(row: Feedback): string {
  return contentFingerprint(row);
}
