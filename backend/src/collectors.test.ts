import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchR, fetchReddit, fingerprintFeedback, RequestPacer, type CollectorHttpRuntime } from './collectors.js';

const rBase = 'http://127.0.0.1:5175';
const redditBase = 'http://127.0.0.1:5174';
const date = '2025-01-01T00:00:00.000Z';
function tweet(id: string, parent: string | null, conversationId: string) {
  return {
    id, text: `feedback ${id}`, author_id: 'player', created_at: date, conversation_id: conversationId,
    public_metrics: { like_count: 5, retweet_count: 2, reply_count: 1, quote_count: 0 },
    referenced_tweets: parent ? [{ type: 'replied_to' as const, id: parent }] : [],
  };
}
function rPage(data: ReturnType<typeof tweet>[], nextToken?: string) {
  if (!data.length) return { meta: { result_count: 0 } };
  return {
    data,
    includes: { users: [{ id: 'player', username: 'player_handle', name: 'Player' }] },
    meta: { result_count: data.length, newest_id: data[0]?.id, oldest_id: data.at(-1)?.id, ...(nextToken ? { next_token: nextToken } : {}) },
  };
}
function post(id = 'post') {
  return {
    id, name: `t3_${id}`, title: 'Title', selftext: 'Body', author: 'writer', score: 4,
    created_utc: 1735689600, num_comments: 2, permalink: `/r/PatchworkTFT/post/${id}`, subreddit: 'PatchworkTFT',
    comments: [
      { id: `${id}-reply`, name: `t1_${id}-reply`, parent_id: `t1_${id}-comment`, author: 'nested', body: 'Nested reply', score: 1, created_utc: 1735689602 },
      { id: `${id}-comment`, name: `t1_${id}-comment`, parent_id: `t3_${id}`, author: 'replier', body: 'Reply', score: 2, created_utc: 1735689601 },
    ],
  };
}
function redditPage(posts: ReturnType<typeof post>[], after: string | null = null) {
  return { kind: 'Listing', data: { after, dist: posts.length, children: posts.map((data) => ({ kind: 't3', data })) } };
}

function mockHttp(responses: unknown[], initialTime = 0) {
  const calls: Array<{ url: URL; headers: Headers; time: number }> = [];
  const waits: number[] = [];
  let time = initialTime;
  const runtime: CollectorHttpRuntime = {
    now: () => time,
    wait: async (milliseconds) => { waits.push(milliseconds); time += milliseconds; },
    fetch: async (input, init) => {
      calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers), time });
      assert.ok(responses.length, `Unexpected request: ${input}`);
      const response = responses.shift();
      return response instanceof Response ? response : Response.json(response);
    },
  };
  return { runtime, calls, waits };
}

test('R HTTP collector follows older-page tokens and orders nested replies after parents', async () => {
  const http = mockHttp([
    rPage([tweet('reply', 'child', 'root')], 'older'),
    rPage([tweet('child', 'root', 'root')], 'older-root'),
    rPage([tweet('root', null, 'root')]),
  ]);
  const result = await fetchR(rBase, 10, http.runtime);
  assert.deepEqual(result.items.map((row) => row.id), ['r_root', 'r_child', 'r_reply']);
  assert.equal(result.items[2]?.parent_id, 'r_child');
  assert.equal(result.items[2]?.thread_id, 'r_root');
  assert.equal(result.items[1]?.author, 'player_handle');
  assert.equal(result.items[0]?.source_url, `${rBase}/post/root`);
  assert.deepEqual(http.calls.map(({ url }) => url.searchParams.get('next_token')), [null, 'older', 'older-root']);
  for (const { url, headers } of http.calls) {
    assert.equal(url.pathname, '/2/tweets/search/recent');
    assert.equal(url.searchParams.get('query'), '*');
    assert.equal(url.searchParams.get('max_results'), '100');
    assert.equal(headers.get('user-agent'), 'patchwork-collector/1.0');
    assert.equal(headers.get('authorization'), null);
    assert.equal(headers.get('apikey'), null);
  }
});

test('Riotdit HTTP collector retains inline/nested comments and pages from the head', async () => {
  const http = mockHttp([redditPage([post()], 't3_post'), redditPage([])]);
  const result = await fetchReddit('https://riotdit.example', 10, http.runtime);
  assert.deepEqual(result.items.map((row) => row.id), ['mr_post', 'mr_post-comment', 'mr_post-reply']);
  assert.equal(result.items[1]?.external_id, 't1_post-comment');
  assert.equal(result.items[1]?.parent_id, 'mr_post');
  assert.equal(result.items[2]?.parent_id, 'mr_post-comment');
  assert.equal(result.items[2]?.thread_id, 'mr_post');
  assert.equal(result.items[2]?.source_url, 'https://riotdit.example/r/PatchworkTFT/post/post#post-reply');
  assert.deepEqual(http.calls.map(({ url }) => url.searchParams.get('after')), [null, 't3_post']);
  for (const { url, headers } of http.calls) {
    assert.equal(url.origin, 'https://riotdit.example');
    assert.equal(url.pathname, '/r/PatchworkTFT/new.json');
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(headers.get('user-agent'), 'patchwork-collector/1.0');
    assert.equal(headers.get('authorization'), null);
    assert.equal(headers.get('apikey'), null);
  }
});

test('item caps report truncation and do not cap Riotdit inline comments', async () => {
  const rHttp = mockHttp([rPage([tweet('root', null, 'root')], 'more')]);
  const rResult = await fetchR(rBase, 1, rHttp.runtime);
  assert.equal(rResult.items.length, 1);
  assert.equal(rResult.truncated, true);
  const redditHttp = mockHttp([redditPage([post()], 'more')]);
  const redditResult = await fetchReddit(redditBase, 1, redditHttp.runtime);
  assert.equal(redditResult.items.length, 3);
  assert.equal(redditResult.truncated, true);
});

test('engagement-only changes do not change the substantive-content fingerprint', async () => {
  const http = mockHttp([redditPage([post()])]);
  const { items } = await fetchReddit(redditBase, 100, http.runtime);
  const row = items[0]!;
  assert.equal(fingerprintFeedback(row), fingerprintFeedback({ ...row, score: row.score + 1, num_comments: 3 }));
  assert.notEqual(fingerprintFeedback(row), fingerprintFeedback({ ...row, body: 'Changed feedback' }));
});

test('R accepts terminal empty and exact-multiple pages without treating malformed responses as empty', async () => {
  const http = mockHttp([rPage([tweet('root', null, 'root')], 'terminal'), rPage([])]);
  const result = await fetchR(rBase, 10, http.runtime);
  assert.equal(result.pages, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.items.length, 1);
  const exact = mockHttp([
    rPage(Array.from({ length: 100 }, (_, i) => tweet(`exact-${i}`, null, `exact-${i}`)), 'terminal'), rPage([]),
  ]);
  const exactResult = await fetchR(rBase, 200, exact.runtime);
  assert.equal(exactResult.pages, 2);
  assert.equal(exactResult.truncated, false);
  assert.equal(exactResult.items.length, 100);
  assert.equal(exact.calls.length, 2);
  const empty = mockHttp([rPage([])]);
  assert.deepEqual((await fetchR(rBase, 10, empty.runtime)).items, []);
  const malformed = mockHttp([{ meta: { result_count: 1 } }]);
  await assert.rejects(fetchR(rBase, 10, malformed.runtime), /Invalid R search response/);
});

test('R deduplicates overlapping pages and fetches missing conversation parents once', async () => {
  const reply = tweet('reply', 'root', 'root');
  const http = mockHttp([
    rPage([reply], 'older'), rPage([reply]),
    rPage([tweet('root', null, 'root')]),
  ]);
  const result = await fetchR(rBase, 10, http.runtime);
  assert.deepEqual(result.items.map(({ id }) => id), ['r_root', 'r_reply']);
  assert.deepEqual(http.calls.map(({ url }) => url.searchParams.get('query')), ['*', '*', 'conversation_id:root']);
});

test('R retains unresolved replies for the persistence pending-parent mechanism', async () => {
  const http = mockHttp([rPage([tweet('reply', 'missing', 'root')]), rPage([])]);
  const result = await fetchR(rBase, 10, http.runtime);
  assert.equal(result.items[0]?.parent_id, 'r_missing');
  assert.equal(result.pages, 2);
});

for (const source of ['r', 'reddit'] as const) {
  test(`${source} rejects cyclic pagination tokens`, async () => {
    const responses = ['a', 'b', 'a'].map((token) => source === 'r'
      ? rPage([tweet(token, null, token)], token) : redditPage([], token));
    const http = mockHttp(responses);
    await assert.rejects(source === 'r' ? fetchR(rBase, 100, http.runtime) : fetchReddit(redditBase, 100, http.runtime), /repeated cursor/);
  });
}

test('Riotdit exact-full page still fetches terminal empty page', async () => {
  const exact = mockHttp([redditPage(Array.from({ length: 100 }, (_, i) => post(`exact-${i}`)), 't3_exact-99'), redditPage([])]);
  const result = await fetchReddit(redditBase, 200, exact.runtime);
  assert.equal(result.pages, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.items.filter(({ kind }) => kind === 'post').length, 100);
  assert.equal(exact.calls.length, 2);
});

test('Riotdit page-count bound marks a still-paginated sweep incomplete', async () => {
  const responses = Array.from({ length: 100 }, (_, i) => redditPage([post(`page-${i}`)], `cursor-${i + 1}`));
  const http = mockHttp(responses);
  const result = await fetchReddit(redditBase, 5_000, http.runtime);
  assert.equal(result.pages, 100);
  assert.equal(http.calls.length, 100);
  assert.equal(result.truncated, true);
});

test('overlapping Riotdit pages deduplicate external identities and reject internal-ID collisions', async () => {
  const overlapping = mockHttp([redditPage([post('same')], 'cursor'), redditPage([post('same'), post('other')])]);
  const result = await fetchReddit(redditBase, 10, overlapping.runtime);
  assert.equal(result.items.filter(({ kind }) => kind === 'post').length, 2);
  assert.equal(result.items.length, 6);
  const collision = post('collision');
  collision.comments[0]!.id = collision.id;
  collision.comments[0]!.name = `t1_${collision.id}`;
  await assert.rejects(fetchReddit(redditBase, 10, mockHttp([redditPage([collision])]).runtime), /internal ID collision/);
});

test('HTTP errors, malformed JSON, and oversized responses fail the sweep', async () => {
  const oversizedStream = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1)); controller.close(); },
  }));
  for (const [response, message] of [
    [new Response('upstream down', { status: 503 }), /503/],
    [new Response('{'), /invalid JSON/],
    [new Response('{}', { headers: { 'content-length': String(6 * 1024 * 1024) } }), /5 MiB/],
    [oversizedStream, /5 MiB/],
  ] as const) {
    const http = mockHttp([response]);
    await assert.rejects(fetchR(rBase, 10, http.runtime), message);
  }
});

test('first-page 429 retries the identical URL after Retry-After', async () => {
  const http = mockHttp([new Response(null, { status: 429, headers: { 'retry-after': '10' } }), rPage([])]);
  await fetchR(rBase, 10, http.runtime);
  assert.equal(http.calls[0]?.url.href, http.calls[1]?.url.href);
  assert.deepEqual(http.waits, [10_000]);
});

test('later-page 429 retries the current cursor rather than advancing', async () => {
  const http = mockHttp([
    redditPage([], 'older'), new Response(null, { status: 429, headers: { 'retry-after': '2' } }), redditPage([]),
  ]);
  await fetchReddit(redditBase, 10, http.runtime);
  assert.deepEqual(http.calls.map(({ url }) => url.searchParams.get('after')), [null, 'older', 'older']);
  assert.deepEqual(http.waits, [1100, 2000]);
});

test('R request pacing is retained across successive sweeps', async () => {
  const http = mockHttp([rPage([]), rPage([])]);
  const runtime = { ...http.runtime, pacer: new RequestPacer('r', http.runtime.now, http.runtime.wait) };
  await fetchR(rBase, 10, runtime);
  await fetchR(rBase, 10, runtime);
  assert.deepEqual(http.calls.map(({ time }) => time), [0, 5500]);
});

test('rate-limit retry headers support HTTP dates and source-specific reset formats', async () => {
  const now = 1_700_000_000_000;
  const date = mockHttp([
    new Response(null, { status: 429, headers: { 'retry-after': new Date(now + 10_000).toUTCString() } }), rPage([]),
  ], now);
  await fetchR(rBase, 10, date.runtime);
  assert.deepEqual(date.waits, [10_000]);

  const redditReset = mockHttp([
    new Response(null, { status: 429, headers: { 'retry-after': 'invalid', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4' } }), redditPage([]),
  ]);
  await fetchReddit(redditBase, 10, redditReset.runtime);
  assert.deepEqual(redditReset.waits, [4_000]);

  const rReset = mockHttp([
    new Response(null, { status: 429, headers: { 'retry-after': 'invalid', 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': String(now / 1000 + 6) } }), rPage([]),
  ], now);
  await fetchR(rBase, 10, rReset.runtime);
  assert.deepEqual(rReset.waits, [6_000]);
});

test('invalid retry headers use conservative fallbacks; retry exhaustion and deadlines are visible', async () => {
  const fallback = mockHttp([
    new Response(null, { status: 429, headers: { 'retry-after': 'invalid', 'x-rate-limit-reset': 'invalid' } }), rPage([]),
  ]);
  await fetchR(rBase, 10, fallback.runtime);
  assert.deepEqual(fallback.waits, [15 * 60_000]);

  const http = mockHttp(Array.from({ length: 4 }, () => new Response(null, { status: 429, headers: { 'retry-after': '1' } })));
  await assert.rejects(fetchR(rBase, 10, http.runtime), /429 more than 3 times/);
  assert.equal(http.calls.length, 4);
  const long = mockHttp([new Response(null, { status: 429, headers: { 'retry-after': '1200' } })]);
  await assert.rejects(fetchR(rBase, 10, long.runtime), /remaining 20-minute sweep deadline/);
});

test('aborting an active fetch interrupts the request', async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const pending = fetchR(rBase, 10, {
    signal: controller.signal,
    fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal as AbortSignal;
      requestSignal.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
    }),
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(requestSignal);
  controller.abort(new Error('shutdown'));
  await assert.rejects(pending, /shutdown/);
});

test('aborting a sweep interrupts pacing without another HTTP request', async () => {
  const controller = new AbortController();
  const http = mockHttp([rPage([tweet('root', null, 'root')], 'more')]);
  const runtime = { ...http.runtime, signal: controller.signal, wait: async () => { controller.abort(new Error('shutdown')); } };
  await assert.rejects(fetchR(rBase, 10, runtime), /shutdown/);
  assert.equal(http.calls.length, 1);
});
