import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import type { Db } from './db';
import type { PostRow } from './tweets';

type Result = { data: unknown; error: unknown };

const RPC_OUT = {
  data: [{ id: '1850000000000000001', text: 'flashy mage #TFT', author_id: 'hyperroll_tft' }],
  includes: { users: [{ id: 'hyperroll_tft', username: 'hyperroll_tft', name: 'Hyperroll' }] },
  meta: { result_count: 1, newest_id: '1850000000000000001', oldest_id: '1850000000000000001' },
};

const row = (id: string, extra: Partial<PostRow> = {}): PostRow => ({
  id,
  author_username: 'hyperroll_tft',
  author_name: 'Hyperroll',
  body: `post ${id}`,
  reply_to_id: null,
  conversation_id: '1850000000000000001',
  like_count: 5,
  repost_count: 1,
  reply_count: 0,
  created_at: '2026-11-12T10:00:00.123+00:00',
  ...extra,
});

/** Minimal stand-in for supabase-js: rpc() plus chainable from(table) queries that record their calls. */
function fakeDb(opts: { rpc?: () => Result | Promise<Result>; posts?: (calls: unknown[][]) => Result } = {}) {
  const calls: unknown[][] = [];
  const rpc = vi.fn(async (..._args: unknown[]) => (opts.rpc ? opts.rpc() : { data: RPC_OUT, error: null }));
  const from = vi.fn(() => {
    const mine: unknown[][] = [];
    const result = () => Promise.resolve(opts.posts ? opts.posts(mine) : { data: [], error: null });
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'ilike', 'in', 'or', 'order', 'limit']) {
      b[m] = (...args: unknown[]) => {
        mine.push([m, ...args]);
        calls.push([m, ...args]);
        return b;
      };
    }
    b.maybeSingle = () => result().then((r) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }));
    b.then = (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) => result().then(ok, fail);
    return b;
  });
  return { db: { rpc, from } as unknown as Db, rpc, from, calls };
}

const make = (opts?: Parameters<typeof fakeDb>[0]) => {
  const fake = fakeDb(opts);
  const logs: string[] = [];
  const app = createApp({ db: fake.db, log: (l) => logs.push(l) });
  return { ...fake, app, logs };
};

const SEARCH = '/2/tweets/search/recent';

describe('public access', () => {
  it('/2/* works without any token', async () => {
    const { app, rpc } = make();
    const res = await request(app).get(`${SEARCH}?query=*`);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalled();
  });

  it('ignores an Authorization header if a client still sends one', async () => {
    const res = await request(make().app).get(`${SEARCH}?query=*`).set('Authorization', 'Bearer anything');
    expect(res.status).toBe(200);
  });

  it('/api/health is public', async () => {
    const res = await request(make().app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, service: 'r' });
  });

  it('never logs Authorization headers or credential-looking query params', async () => {
    const { app, logs } = make();
    await request(app).get(`${SEARCH}?query=*&access_token=secret-in-query-123`).set('Authorization', 'Bearer secret-in-header-456');
    const all = logs.join('\n');
    expect(all).not.toContain('secret-in-query-123');
    expect(all).not.toContain('secret-in-header-456');
    expect(all).toContain('access_token=REDACTED');
  });
});

describe('search/recent validation', () => {
  it.each([
    ['', 'query'],
    ['query=', 'query'],
    ['query=*&max_results=5', 'max_results'],
    ['query=*&max_results=101', 'max_results'],
    ['query=*&next_token=abc', 'next_token'],
    ['query=conversation_id:abc', 'query'],
  ])('rejects "%s" with 400 naming the param', async (qs, param) => {
    const { app, rpc } = make();
    const res = await request(app).get(`${SEARCH}?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ title: 'Invalid Request', type: 'about:blank', status: 400 });
    expect(res.body.detail).toContain(param);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ignores tweet.fields / expansions / user.fields', async () => {
    const { app } = make();
    const res = await request(app).get(`${SEARCH}?query=*&tweet.fields=created_at&expansions=author_id&user.fields=name`);
    expect(res.status).toBe(200);
  });
});

describe('search/recent queries', () => {
  it('passes text and hashtags to the RPC and returns its JSON as-is', async () => {
    const { app, rpc } = make();
    const res = await request(app).get(`${SEARCH}?query=%23TFT&max_results=10`);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('search_recent', { p_query: '#TFT', p_max_results: 10, p_next_token: null });
    expect(res.body).toEqual(RPC_OUT);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('maps * to p_query: null', async () => {
    const { app, rpc } = make();
    await request(app).get(`${SEARCH}?query=*`);
    expect(rpc).toHaveBeenCalledWith('search_recent', { p_query: null, p_max_results: 10, p_next_token: null });
  });

  it('returns { meta: { result_count: 0 } } when the RPC finds nothing', async () => {
    const { app } = make({ rpc: () => ({ data: { data: [], includes: { users: [] }, meta: { result_count: 0 } }, error: null }) });
    const res = await request(app).get(`${SEARCH}?query=nothing`);
    expect(res.body).toEqual({ meta: { result_count: 0 } });
  });

  it('conversation_id: selects the thread and shapes it like the RPC', async () => {
    const rows = [
      row('1850000000000000102', { reply_to_id: '1850000000000000101', author_username: 'b', author_name: 'B' }),
      row('1850000000000000101', { reply_to_id: '1850000000000000001' }),
      row('1850000000000000001'),
    ];
    const { app, calls, rpc } = make({ posts: () => ({ data: rows, error: null }) });
    const res = await request(app).get(`${SEARCH}?query=conversation_id:1850000000000000001&max_results=10`);
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    expect(calls).toContainEqual(['eq', 'conversation_id', '1850000000000000001']);
    expect(calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(calls).toContainEqual(['limit', 10]);

    expect(res.body.meta).toEqual({ result_count: 3, newest_id: '1850000000000000102', oldest_id: '1850000000000000001' });
    expect(res.body.data[0]).toEqual({
      id: '1850000000000000102',
      text: 'post 1850000000000000102',
      author_id: 'b',
      created_at: '2026-11-12T10:00:00.123Z',
      conversation_id: '1850000000000000001',
      public_metrics: { like_count: 5, retweet_count: 1, reply_count: 0, quote_count: 0 },
      referenced_tweets: [{ type: 'replied_to', id: '1850000000000000101' }],
    });
    expect(res.body.data[2].referenced_tweets).toEqual([]);
    expect(res.body.includes.users).toEqual([
      { id: 'b', username: 'b', name: 'B' },
      { id: 'hyperroll_tft', username: 'hyperroll_tft', name: 'Hyperroll' },
    ]);
  });

  it('sets next_token only when the page is full', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(String(1850000000000000100 - i)));
    const { app } = make({ posts: () => ({ data: rows, error: null }) });
    const res = await request(app).get(`${SEARCH}?query=from:hyperroll_tft`);
    expect(res.body.meta.next_token).toBe(rows[9].id);
  });

  it('from: matches the username literally (underscore escaped)', async () => {
    const { app, calls } = make({ posts: () => ({ data: [row('1')], error: null }) });
    await request(app).get(`${SEARCH}?query=from:hyperroll_tft`);
    expect(calls).toContainEqual(['ilike', 'author_username', 'hyperroll\\_tft']);
  });

  it('returns { meta: { result_count: 0 } } for an empty from:', async () => {
    const { app } = make({ posts: () => ({ data: [], error: null }) });
    const res = await request(app).get(`${SEARCH}?query=from:nobody`);
    expect(res.body).toEqual({ meta: { result_count: 0 } });
  });

  it('400s an unknown next_token', async () => {
    const { app } = make({ posts: () => ({ data: null, error: null }) });
    const res = await request(app).get(`${SEARCH}?query=*&next_token=123`);
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain('next_token');
  });
});

describe('tweet lookup', () => {
  it('/2/tweets/:id returns data + includes', async () => {
    const { app } = make({ posts: () => ({ data: [row('1850000000000000001')], error: null }) });
    const res = await request(app).get('/2/tweets/1850000000000000001');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('1850000000000000001');
    expect(res.body.includes.users[0].username).toBe('hyperroll_tft');
  });

  it('/2/tweets/<missing> → 200 with an errors array', async () => {
    const { app } = make({ posts: () => ({ data: [], error: null }) });
    const res = await request(app).get('/2/tweets/999');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeUndefined();
    expect(res.body.errors[0]).toMatchObject({ title: 'Not Found Error', value: '999', resource_id: '999', parameter: 'id' });
  });

  it('/2/tweets?ids= returns found posts in order plus errors for missing ones', async () => {
    const { app } = make({ posts: () => ({ data: [row('2'), row('1')], error: null }) });
    const res = await request(app).get('/2/tweets?ids=1,2,3');
    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { id: string }) => t.id)).toEqual(['1', '2']);
    expect(res.body.errors.map((e: { value: string }) => e.value)).toEqual(['3']);
  });

  it('/2/tweets?ids= validates the list', async () => {
    const { app } = make();
    expect((await request(app).get('/2/tweets')).status).toBe(400);
    expect((await request(app).get('/2/tweets?ids=1,abc')).status).toBe(400);
    const tooMany = Array.from({ length: 101 }, (_, i) => i + 1).join(',');
    expect((await request(app).get(`/2/tweets?ids=${tooMany}`)).status).toBe(400);
  });

  it('404s unknown /2 routes in the problem shape', async () => {
    const res = await request(make().app).get('/2/users/me');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ title: 'Not Found', type: 'about:blank', status: 404, detail: 'Not Found' });
  });
});

describe('rate limit', () => {
  it('allows 180 requests per window per IP, then 429s with headers', async () => {
    const { app } = make();
    const first = await request(app).get(`${SEARCH}?query=*`);
    expect(first.headers['x-rate-limit-limit']).toBe('180');
    expect(first.headers['x-rate-limit-remaining']).toBe('179');
    expect(Number(first.headers['x-rate-limit-reset'])).toBeGreaterThan(Date.now() / 1000);
    for (let i = 1; i < 180; i++) await request(app).get(`${SEARCH}?query=*`);

    const res = await request(app).get(`${SEARCH}?query=*`);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ title: 'Too Many Requests', type: 'about:blank', status: 429, detail: 'Too Many Requests' });
    expect(res.headers['x-rate-limit-remaining']).toBe('0');
    expect(res.headers['x-rate-limit-reset']).toBeDefined();
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('upstream failures', () => {
  const fakeHost = ['abc', 'supabase', 'co'].join('.');
  const fakeJwt = ['e', 'y', 'J', 'hbGciOi'].join('');

  it('returns 502 without leaking the Supabase error', async () => {
    const secret = `permission denied for schema mockr at https://${fakeHost} key ${fakeJwt}`;
    const { app, logs } = make({ rpc: () => ({ data: null, error: { code: '42501', message: secret } }) });
    const res = await request(app).get(`${SEARCH}?query=*`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ title: 'Bad Gateway', type: 'about:blank', status: 502, detail: 'Bad Gateway' });
    for (const s of ['permission', fakeHost, fakeJwt]) {
      expect(res.text).not.toContain(s);
      expect(logs.join('\n')).not.toContain(s);
    }
  });

  it('returns 502 when the client throws, and health turns 503', async () => {
    const { app } = make({ rpc: () => Promise.reject(new Error(`fetch failed https://${fakeHost}`)), posts: () => { throw new Error('down'); } });
    const res = await request(app).get(`${SEARCH}?query=*`);
    expect(res.status).toBe(502);
    expect(res.text).not.toContain(fakeHost);
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(503);
    expect(health.body.ok).toBe(false);
  });
});
