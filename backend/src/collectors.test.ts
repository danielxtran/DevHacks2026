import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchR, fetchReddit, fingerprintFeedback, type RpcClient } from './collectors.js';

const date = '2025-01-01T00:00:00.000Z';
function tweet(id: string, parent: string | null, conversationId: string) {
  return {
    id, text: `feedback ${id}`, author_id: 'player', created_at: date, conversation_id: conversationId,
    public_metrics: { like_count: 5, retweet_count: 2, reply_count: 1, quote_count: 0 },
    referenced_tweets: parent ? [{ type: 'replied_to' as const, id: parent }] : [],
  };
}
function rPage(data: ReturnType<typeof tweet>[], nextToken?: string) {
  return {
    data,
    includes: { users: [{ id: 'player', username: 'player_handle', name: 'Player' }] },
    meta: { result_count: data.length, newest_id: data[0]?.id, oldest_id: data.at(-1)?.id, ...(nextToken ? { next_token: nextToken } : {}) },
  };
}

function mockRpc(responses: unknown[]): RpcClient & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: responses.shift(), error: null };
    },
  };
}

test('R collector follows older-page tokens and orders nested replies after their parents', async () => {
  const client = mockRpc([
    rPage([tweet('reply', 'child', 'root')], 'older'),
    rPage([tweet('child', 'root', 'root')], 'older-root'),
    rPage([tweet('root', null, 'root')]),
  ]);
  const result = await fetchR(client, 10);
  assert.deepEqual(result.items.map((row) => row.id), ['r_root', 'r_child', 'r_reply']);
  assert.equal(result.items[2]?.parent_id, 'r_child');
  assert.equal(result.items[2]?.thread_id, 'r_root');
  assert.equal(result.items[1]?.author, 'player_handle');
  assert.deepEqual(client.calls.map(({ args }) => args.p_next_token), [null, 'older', 'older-root']);
});

test('Reddit normalizes nested comments and pages from the head', async () => {
  const client = mockRpc([{
    kind: 'Listing', data: { after: null, dist: 1, children: [{ kind: 't3', data: {
      id: 'post', name: 't3_post', title: 'Title', selftext: 'Body', author: 'writer', score: 4,
      created_utc: 1735689600, num_comments: 1, permalink: '/r/PatchworkTFT/post/post', subreddit: 'PatchworkTFT',
      comments: [{ id: 'comment', name: 't1_comment', parent_id: 't3_post', author: 'replier', body: 'Reply', score: 2, created_utc: 1735689601 }],
    } }] },
  }]);
  const result = await fetchReddit(client, 10);
  assert.deepEqual(result.items.map((row) => row.id), ['mr_post', 'mr_comment']);
  assert.equal(result.items[1]?.external_id, 't1_comment');
  assert.equal(result.items[1]?.parent_id, 'mr_post');
  assert.equal(result.items[1]?.thread_id, 'mr_post');
  assert.equal(client.calls[0]?.args.p_sort, 'new');
});

test('R cap reports truncation instead of claiming a complete sweep', async () => {
  const client = mockRpc([rPage(Array.from({ length: 10 }, (_, i) => tweet(String(i), null, String(i))), 'more')]);
  const result = await fetchR(client, 10);
  assert.equal(result.items.length, 10);
  assert.equal(result.truncated, true);
});

test('engagement-only changes do not change the substantive-content fingerprint', () => {
  const client = mockRpc([{
    kind: 'Listing', data: { after: null, dist: 1, children: [{ kind: 't3', data: {
      id: 'post', name: 't3_post', title: 'Title', selftext: 'Body', author: 'writer', score: 4,
      created_utc: 1735689600, num_comments: 0, permalink: '/post/post', subreddit: 'PatchworkTFT', comments: [],
    } }] },
  }]);
  return fetchReddit(client).then(({ items }) => {
    const row = items[0]!;
    assert.equal(fingerprintFeedback(row), fingerprintFeedback({ ...row, score: row.score + 1, num_comments: 3 }));
    assert.notEqual(fingerprintFeedback(row), fingerprintFeedback({ ...row, body: 'Changed feedback' }));
  });
});
