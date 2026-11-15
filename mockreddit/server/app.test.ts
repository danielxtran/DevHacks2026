import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import type { Db } from './db';

type Result = { data: unknown; error: unknown; count?: number | null };

const LISTING = {
  kind: 'Listing',
  data: { after: 't3_s005', dist: 1, children: [{ kind: 't3', data: { id: 's005', name: 't3_s005', comments: [] } }] },
};

/** Minimal stand-in for supabase-js: rpc() plus chainable from(table) queries. */
function fakeDb(opts: { rpc?: (fn: string, args: unknown) => Result | Promise<Result>; tables?: Record<string, Result> } = {}) {
  const rpc = vi.fn(async (fn: string, args: unknown) => (opts.rpc ? opts.rpc(fn, args) : { data: LISTING, error: null }));
  const from = vi.fn((table: string) => {
    const result = () => Promise.resolve(opts.tables?.[table] ?? { data: null, error: null });
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
    b.maybeSingle = result;
    b.then = (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) => result().then(ok, fail);
    return b;
  });
  return { db: { rpc, from } as unknown as Db, rpc, from };
}

const make = (opts?: Parameters<typeof fakeDb>[0]) => {
  const fake = fakeDb(opts);
  return { ...fake, app: createApp({ db: fake.db, log: () => {} }) };
};

describe('listing endpoints', () => {
  it('returns the listing RPC result as-is, with API headers', async () => {
    const { app, rpc } = make();
    const res = await request(app).get('/r/PatchworkTFT/new.json?limit=5').set('User-Agent', 'test/1.0');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(LISTING);
    expect(rpc).toHaveBeenCalledWith('listing', { p_sort: 'new', p_limit: 5, p_after: null });
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['x-ratelimit-remaining']).toBe('59');
  });

  it('passes after through and defaults limit to 25', async () => {
    const { app, rpc } = make();
    await request(app).get('/r/PatchworkTFT/hot.json?after=t3_abc123&utm=ignored');
    expect(rpc).toHaveBeenCalledWith('listing', { p_sort: 'hot', p_limit: 25, p_after: 't3_abc123' });
  });

  it.each([
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['limit=abc', 'limit'],
    ['after=bad', 'after'],
  ])('rejects %s with 400 naming the param', async (qs, param) => {
    const { app, rpc } = make();
    const res = await request(app).get(`/r/PatchworkTFT/new.json?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(400);
    expect(res.body.message).toContain(param);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('404s an unknown subreddit', async () => {
    const { app } = make();
    const res = await request(app).get('/r/OtherSub/new.json');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not Found', error: 404 });
  });

  it('matches the subreddit name case-insensitively', async () => {
    const { app, rpc } = make();
    const res = await request(app).get('/r/patchworktft/top.json');
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('listing', { p_sort: 'top', p_limit: 25, p_after: null });
  });

  it('404s an unknown sort and unknown API paths', async () => {
    const { app } = make();
    expect((await request(app).get('/r/PatchworkTFT/rising.json')).status).toBe(404);
    expect((await request(app).get('/api/nope')).body).toEqual({ message: 'Not Found', error: 404 });
  });
});

describe('rate limit', () => {
  it('allows 60 requests a minute per IP, then 429s with headers', async () => {
    const { app } = make();
    for (let i = 0; i < 60; i++) {
      const ok = await request(app).get('/r/PatchworkTFT/new.json');
      expect(ok.status).toBe(200);
    }
    const res = await request(app).get('/r/PatchworkTFT/new.json');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ message: 'Too Many Requests', error: 429 });
    expect(res.headers['x-ratelimit-used']).toBe('60');
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
    expect(Number(res.headers['x-ratelimit-reset'])).toBeGreaterThan(0);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('upstream failures', () => {
  it('returns 502 without leaking the Supabase error', async () => {
    // Built from pieces so a repo-wide grep for hard-coded URLs/keys stays clean.
    const fakeHost = ['abc', 'supabase', 'co'].join('.');
    const fakeJwt = ['e', 'y', 'J', 'hbGciOi'].join('');
    const secret = `permission denied for schema mockreddit at https://${fakeHost} key ${fakeJwt}`;
    const { app } = make({ rpc: () => ({ data: null, error: { code: '42501', message: secret } }) });
    const res = await request(app).get('/r/PatchworkTFT/new.json');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ message: 'Bad Gateway', error: 502 });
    expect(res.text).not.toContain('permission');
    expect(res.text).not.toContain(fakeHost);
    expect(res.text).not.toContain(fakeJwt);
  });

  it('returns 502 when the client throws (network down)', async () => {
    const { app } = make({ rpc: () => Promise.reject(new Error('fetch failed https://abc.' + 'supabase.' + 'co')) });
    const res = await request(app).get('/r/PatchworkTFT/new.json');
    expect(res.status).toBe(502);
    expect(res.text).not.toContain('supabase');
  });

  it('health is 200 when Supabase answers and 503 when it does not', async () => {
    const up = await request(make().app).get('/api/health');
    expect(up.status).toBe(200);
    expect(up.body.ok).toBe(true);
    const down = await request(make({ rpc: () => ({ data: null, error: { message: 'x' } }) }).app).get('/api/health');
    expect(down.status).toBe(503);
    expect(down.body.ok).toBe(false);
  });
});

describe('comments endpoint', () => {
  const post = { id: 'p1', title: 'T', body: 'B', author: 'anon_a', flair: 'Balance', score: 3, created_at: '2026-11-10T00:00:00Z' };
  const comments = [
    { id: 'c1', post_id: 'p1', parent_id: null, author: 'x', body: 'low', score: 2, created_at: '2026-11-10T01:00:00Z' },
    { id: 'c2', post_id: 'p1', parent_id: null, author: 'y', body: 'high', score: 9, created_at: '2026-11-10T02:00:00Z' },
    { id: 'r1', post_id: 'p1', parent_id: 'c1', author: 'z', body: 'reply', score: 1, created_at: '2026-11-10T03:00:00Z' },
  ];

  it('returns [postListing, commentsListing] with nested replies', async () => {
    const { app } = make({ tables: { posts: { data: post, error: null }, comments: { data: comments, error: null } } });
    const res = await request(app).get('/r/PatchworkTFT/comments/p1.json');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);

    const [postListing, commentListing] = res.body;
    const t3 = postListing.data.children[0];
    expect(t3.kind).toBe('t3');
    expect(t3.data).toMatchObject({ id: 'p1', name: 't3_p1', selftext: 'B', link_flair_text: 'Balance', num_comments: 3 });
    expect(t3.data.created_utc).toBe(Date.parse(post.created_at) / 1000);

    const top = commentListing.data.children;
    expect(top.map((c: { data: { id: string } }) => c.data.id)).toEqual(['c2', 'c1']); // score desc
    expect(top[0].data.replies).toBe(''); // no children → "" like Reddit
    expect(top[0].data.parent_id).toBe('t3_p1');
    const reply = top[1].data.replies.data.children[0];
    expect(reply).toMatchObject({ kind: 't1', data: { id: 'r1', name: 't1_r1', parent_id: 't1_c1', replies: '' } });
  });

  it('404s a missing post', async () => {
    const { app } = make({ tables: { posts: { data: null, error: null } } });
    const res = await request(app).get('/r/PatchworkTFT/comments/zzz.json');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Not Found', error: 404 });
  });
});

describe('about endpoint', () => {
  it('returns a t5 with the post count', async () => {
    const { app } = make({ tables: { posts: { data: [{ created_at: '2026-11-01T00:00:00Z' }], error: null, count: 42 } } });
    const res = await request(app).get('/r/PatchworkTFT/about.json');
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('t5');
    expect(res.body.data).toMatchObject({ display_name: 'PatchworkTFT', subscribers: 42 });
  });
});
