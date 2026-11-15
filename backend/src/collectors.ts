import { createHash } from 'node:crypto';
import { FeedbackSchema, RedditListingSchema, RSearchSchema, type Feedback, type RSearchPage, type RTweet } from './contracts.js';

export interface SourceSweep<T> {
  source: 'reddit' | 'r';
  items: T[];
  pages: number;
  truncated: boolean;
}

type Source = SourceSweep<Feedback>['source'];
export type CollectorWait = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export interface CollectorHttpRuntime {
  fetch?: typeof fetch;
  now?: () => number;
  wait?: CollectorWait;
}

interface HttpRuntime extends CollectorHttpRuntime {
  signal?: AbortSignal;
  pacer?: RequestPacer;
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_SWEEP_MS = 20 * 60_000;
const MAX_429_RETRIES = 3;
const FALLBACK_RETRY_MS: Record<Source, number> = { reddit: 60_000, r: 15 * 60_000 };
const USER_AGENT = 'patchwork-collector/1.0';

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error('Source collection cancelled.');
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, Math.max(0, milliseconds));
    function done() {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      reject(abortError(signal));
    }
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const aborted = () => reject(abortError(signal));
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', aborted); resolve(value); },
      (error) => { signal.removeEventListener('abort', aborted); reject(error); },
    );
  });
}

function resetAt(headers: Headers, source: Source, now: number): number | null {
  const raw = headers.get(source === 'reddit' ? 'x-ratelimit-reset' : 'x-rate-limit-reset');
  if (raw === null || !/^\d+(?:\.\d+)?$/.test(raw.trim())) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return source === 'reddit' ? now + value * 1000 : value * 1000;
}

function retryAfterMs(headers: Headers, source: Source, now: number): number {
  const raw = headers.get('retry-after')?.trim();
  if (raw) {
    if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw) * 1000;
    if (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)) {
      const date = Date.parse(raw);
      if (Number.isFinite(date)) return Math.max(0, date - now);
    }
  }
  const reset = resetAt(headers, source, now);
  return reset === null ? FALLBACK_RETRY_MS[source] : Math.max(0, reset - now);
}

export class RequestPacer {
  private readyAt = 0;
  private readonly minimumSpacingMs: number;

  constructor(private readonly source: Source, private readonly now: () => number = Date.now, private readonly wait: CollectorWait = abortableSleep) {
    this.minimumSpacingMs = source === 'reddit' ? 1_100 : 5_500;
  }

  async waitForTurn(deadline: number, signal?: AbortSignal): Promise<void> {
    const delay = Math.max(0, this.readyAt - this.now());
    if (delay > 0) {
      if (this.now() + delay >= deadline) throw new Error('Source sweep deadline would be exceeded while pacing requests.');
      await withAbort(this.wait(delay, signal), signal);
    }
    if (signal?.aborted) throw abortError(signal);
    if (this.now() >= deadline) throw new Error('Source sweep exceeded its 20-minute deadline.');
    this.readyAt = Math.max(this.readyAt, this.now()) + this.minimumSpacingMs;
  }

  deferUntil(timestamp: number): void {
    this.readyAt = Math.max(this.readyAt, timestamp);
  }

  observe(headers: Headers, now: number): void {
    const remaining = headers.get(this.source === 'reddit' ? 'x-ratelimit-remaining' : 'x-rate-limit-remaining');
    const reset = resetAt(headers, this.source, now);
    if (remaining?.trim() === '0' && reset !== null) this.deferUntil(reset);
  }

  retryDelay(headers: Headers, now: number): number {
    return retryAfterMs(headers, this.source, now);
  }
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Source base URL must be a valid HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Source base URL must use HTTP(S) and must not contain credentials.');
  }
  return url;
}

function makeRequestUrl(base: URL, path: string, query: Record<string, string | undefined>): URL {
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error('Source endpoint escaped its configured base URL.');
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value);
  return url;
}

function runtimeFor(source: Source, runtime: HttpRuntime) {
  const now = runtime.now ?? Date.now;
  const wait = runtime.wait ?? abortableSleep;
  return {
    fetch: runtime.fetch ?? globalThis.fetch,
    now,
    wait,
    signal: runtime.signal,
    pacer: runtime.pacer ?? new RequestPacer(source, now, wait),
    deadline: now() + MAX_SWEEP_MS,
  };
}

async function readBody(response: Response, signal: AbortSignal): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('Source response exceeded the 5 MiB limit.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Source response exceeded the 5 MiB limit.');
      chunks.push(value);
    }
  } finally {
    if (signal.aborted || size > MAX_RESPONSE_BYTES) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

function errorDetail(body: string): string {
  try {
    const value = JSON.parse(body) as { message?: unknown; detail?: unknown };
    const message = value.message ?? value.detail;
    if (typeof message === 'string') return message.slice(0, 500);
  } catch { /* Keep a bounded non-JSON error body for diagnostics. */ }
  return body.slice(0, 500);
}

async function fetchJson<T>(url: URL, source: Source, context: ReturnType<typeof runtimeFor>): Promise<T> {
  let retries = 0;
  while (true) {
    await context.pacer.waitForTurn(context.deadline, context.signal);
    const startedAt = context.now();
    const remainingMs = context.deadline - startedAt;
    if (remainingMs <= 0) throw new Error('Source sweep exceeded its 20-minute deadline.');
    const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, remainingMs);
    const timeoutError = new Error(timeoutMs < REQUEST_TIMEOUT_MS
      ? 'Source sweep exceeded its 20-minute deadline during an HTTP request.'
      : 'Source HTTP request exceeded its 10-second timeout.');
    const controller = new AbortController();
    const parentAbort = () => controller.abort(abortError(context.signal));
    context.signal?.addEventListener('abort', parentAbort, { once: true });
    if (context.signal?.aborted) parentAbort();
    const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);

    let response: Response;
    let body = '';
    try {
      response = await withAbort(context.fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      }), controller.signal);
      context.pacer.observe(response.headers, context.now());
      if (response.status !== 429) body = await readBody(response, controller.signal);
      else void response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (controller.signal.aborted) throw abortError(controller.signal);
      throw error;
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener('abort', parentAbort);
    }

    if (response.status === 429) {
      if (retries >= MAX_429_RETRIES) throw new Error(`${source} API returned 429 more than ${MAX_429_RETRIES} times for one page.`);
      const delay = context.pacer.retryDelay(response.headers, context.now());
      const retryAt = context.now() + delay;
      if (retryAt >= context.deadline) throw new Error('Source rate-limit cooldown exceeds the remaining 20-minute sweep deadline.');
      context.pacer.deferUntil(retryAt);
      retries++;
      continue;
    }
    if (!response.ok) throw new Error(`${source} API ${response.status}${body ? `: ${errorDetail(body)}` : ''}`);
    try { return JSON.parse(body) as T; }
    catch { throw new Error(`${source} API returned invalid JSON.`); }
  }
}

function contentFingerprint(row: Omit<Feedback, 'content_fingerprint'> | Feedback): string {
  const { score: _score, num_comments: _numComments, ...substantive } = row;
  return createHash('sha256').update(JSON.stringify(substantive)).digest('hex');
}

function parentFirst(rows: Feedback[]): Feedback[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const depths = new Map<string, number>();
  for (const row of rows) {
    if (depths.has(row.id)) continue;
    const path: Feedback[] = [];
    const seen = new Set<string>();
    let current: Feedback | undefined = row;
    while (current && !depths.has(current.id)) {
      if (seen.has(current.id)) throw new Error(`Feedback parent cycle at ${current.id}`);
      seen.add(current.id);
      path.push(current);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    let depth = current ? depths.get(current.id)! + 1 : 0;
    for (const item of path.reverse()) depths.set(item.id, depth++);
  }
  return [...rows].sort((a, b) => depths.get(a.id)! - depths.get(b.id)! || a.posted_at.localeCompare(b.posted_at));
}

function validatedFeedback(row: unknown): Feedback {
  const result = FeedbackSchema.safeParse(row);
  if (!result.success) throw new Error(`Invalid normalized feedback: ${result.error.message}`);
  return result.data;
}

function addFeedback(rows: Map<string, Feedback>, ids: Map<string, string>, row: Feedback): void {
  const idForExternal = rows.get(row.external_id)?.id;
  if (idForExternal && idForExternal !== row.id) throw new Error(`Source external identity collision for ${row.external_id}`);
  const externalForId = ids.get(row.id);
  if (externalForId && externalForId !== row.external_id) throw new Error(`Source internal ID collision for ${row.id}`);
  rows.set(row.external_id, row);
  ids.set(row.id, row.external_id);
}

function riotditLink(base: URL, permalink: string, commentId?: string): string {
  const url = new URL(permalink, base);
  if (url.origin !== base.origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new Error('Riotdit returned a source link outside its configured base URL.');
  if (commentId) url.hash = commentId;
  return url.toString();
}

export async function fetchReddit(baseUrl: string, maxPosts = 1000, runtime: HttpRuntime = {}): Promise<SourceSweep<Feedback>> {
  const base = parseBaseUrl(baseUrl);
  const context = runtimeFor('reddit', runtime);
  const normalized = new Map<string, Feedback>();
  const ids = new Map<string, string>();
  const cursors = new Set<string>();
  const seenPosts = new Set<string>();
  let after: string | null = null;
  let postCount = 0;
  let pages = 0;
  let truncated = false;

  while (true) {
    if (pages >= MAX_PAGES) { truncated = true; break; }
    const url = makeRequestUrl(base, '/r/PatchworkTFT/new.json', { limit: '100', after: after ?? undefined });
    const payload = await fetchJson<unknown>(url, 'reddit', context);
    const page = RedditListingSchema.parse(payload);
    pages++;

    for (const { data: post } of page.data.children) {
      if (!seenPosts.has(post.name)) {
        if (postCount >= maxPosts) { truncated = true; break; }
        seenPosts.add(post.name);
        postCount++;
      }
      const rootId = `mr_${post.id}`;
      const postLink = riotditLink(base, post.permalink);
      addFeedback(normalized, ids, validatedFeedback({
        id: rootId, external_id: post.name, source: 'reddit', fixture_set: 'mock-live', kind: 'post',
        parent_id: null, thread_id: null, title: post.title, body: post.selftext, score: post.score,
        author: post.author, posted_at: new Date(post.created_utc * 1000).toISOString(),
        num_comments: post.num_comments, source_url: postLink,
      }));
      for (const comment of post.comments) {
        const parent = /^(?:t1|t3)_(.+)$/.exec(comment.parent_id)?.[1];
        if (!parent) throw new Error(`Riotdit comment ${comment.id} has an invalid parent_id.`);
        addFeedback(normalized, ids, validatedFeedback({
          id: `mr_${comment.id}`, external_id: comment.name, source: 'reddit', fixture_set: 'mock-live', kind: 'comment',
          parent_id: `mr_${parent}`, thread_id: rootId, title: null, body: comment.body,
          score: comment.score, author: comment.author, posted_at: new Date(comment.created_utc * 1000).toISOString(),
          num_comments: null, source_url: riotditLink(base, post.permalink, comment.id),
        }));
      }
    }

    after = page.data.after;
    if (!after) break;
    if (cursors.has(after)) throw new Error(`Riotdit API repeated cursor ${after}`);
    cursors.add(after);
    if (postCount >= maxPosts || pages >= MAX_PAGES) { truncated = true; break; }
  }

  return { source: 'reddit', items: parentFirst([...normalized.values()]), pages, truncated };
}

function addTweet(
  tweets: Map<string, RTweet>,
  authors: Map<string, string>,
  page: RSearchPage,
  maxItems: number,
): boolean {
  if ('includes' in page) for (const user of page.includes.users) authors.set(user.id, user.username || user.name);
  if (!('data' in page)) return true;
  for (const tweet of page.data) {
    if (!tweets.has(tweet.id) && tweets.size >= maxItems) return false;
    tweets.set(tweet.id, tweet);
  }
  return true;
}

function parseRPage(payload: unknown) {
  const result = RSearchSchema.safeParse(payload);
  if (!result.success) throw new Error(`Invalid R search response: ${result.error.message}`);
  return result.data;
}

function normalizeTweet(tweet: RTweet, authors: Map<string, string>, base: URL): Feedback {
  const parentId = tweet.referenced_tweets[0]?.id;
  const root = parentId === undefined;
  return validatedFeedback({
    id: `r_${tweet.id}`, external_id: tweet.id, source: 'r', fixture_set: 'mock-live', kind: root ? 'post' : 'comment',
    parent_id: parentId ? `r_${parentId}` : null,
    thread_id: root ? null : `r_${tweet.conversation_id}`,
    title: null, body: tweet.text, score: tweet.public_metrics.like_count,
    author: authors.get(tweet.author_id) ?? tweet.author_id, posted_at: tweet.created_at,
    num_comments: root ? tweet.public_metrics.reply_count : null,
    source_url: new URL(`/post/${encodeURIComponent(tweet.id)}`, base).toString(),
  });
}

export async function fetchR(baseUrl: string, maxPosts = 500, runtime: HttpRuntime = {}): Promise<SourceSweep<Feedback>> {
  const base = parseBaseUrl(baseUrl);
  const context = runtimeFor('r', runtime);
  const tweets = new Map<string, RTweet>();
  const authors = new Map<string, string>();
  const cursorsByQuery = new Map<string, Set<string>>();
  let pages = 0;
  let truncated = false;

  const crawl = async (query: string): Promise<void> => {
    let token: string | undefined;
    const cursors = cursorsByQuery.get(query) ?? new Set<string>();
    cursorsByQuery.set(query, cursors);
    while (true) {
      if (pages >= MAX_PAGES) { truncated = true; return; }
      const url = makeRequestUrl(base, '/2/tweets/search/recent', {
        query, max_results: '100', next_token: token,
      });
      const page = parseRPage(await fetchJson<unknown>(url, 'r', context));
      pages++;
      const hadRoom = addTweet(tweets, authors, page, maxPosts);
      if (!hadRoom) truncated = true;
      token = 'next_token' in page.meta ? page.meta.next_token : undefined;
      if (!token) return;
      if (cursors.has(token)) throw new Error(`R API repeated cursor ${token}`);
      cursors.add(token);
      if (!hadRoom || tweets.size >= maxPosts || pages >= MAX_PAGES) { truncated = true; return; }
    }
  };

  await crawl('*');
  if (!truncated) {
    const missingConversations = new Set<string>();
    for (const tweet of tweets.values()) {
      const parent = tweet.referenced_tweets[0]?.id;
      if (parent && !tweets.has(parent)) missingConversations.add(tweet.conversation_id);
    }
    for (const conversationId of missingConversations) {
      if (truncated) break;
      if (tweets.size >= maxPosts || pages >= MAX_PAGES) { truncated = true; break; }
      await crawl(`conversation_id:${conversationId}`);
    }
  }

  const normalized = new Map<string, Feedback>();
  const ids = new Map<string, string>();
  for (const tweet of tweets.values()) addFeedback(normalized, ids, normalizeTweet(tweet, authors, base));
  return { source: 'r', items: parentFirst([...normalized.values()]), pages, truncated };
}

export function fingerprintFeedback(row: Feedback): string {
  return contentFingerprint(row);
}
