import assert from 'node:assert/strict';
import test from 'node:test';
import { FeedbackSchema } from './contracts.js';

const redditRoot = {
  id: 'mr_s001', external_id: 't3_s001', source: 'reddit', fixture_set: 'mock-live', kind: 'post',
  parent_id: null, thread_id: null, title: 'A complaint', body: 'This is too strong', score: 12,
  author: 'anon_user', posted_at: '2025-01-01T00:00:00.000Z', num_comments: 1,
  source_url: 'http://127.0.0.1:5174/r/PatchworkTFT/post/s001',
};

test('normalized root feedback preserves source identity and accepts null titles for R', () => {
  assert.equal(FeedbackSchema.parse(redditRoot).id, 'mr_s001');
  assert.equal(FeedbackSchema.parse({
    ...redditRoot, id: 'r_123', external_id: '123', source: 'r', title: null,
    source_url: 'http://127.0.0.1:5175/post/123', num_comments: 2,
  }).id, 'r_123');
});

test('normalized comments require parent and thread context', () => {
  const comment = {
    ...redditRoot, id: 'mr_c001', external_id: 't1_c001', kind: 'comment', title: null,
    parent_id: 'mr_s001', thread_id: 'mr_s001', num_comments: null,
  };
  assert.equal(FeedbackSchema.parse(comment).parent_id, 'mr_s001');
  assert.equal(FeedbackSchema.safeParse({ ...comment, parent_id: null }).success, false);
});

test('normalized feedback rejects source identity collisions', () => {
  assert.equal(FeedbackSchema.safeParse({ ...redditRoot, id: 'r_s001' }).success, false);
  assert.equal(FeedbackSchema.safeParse({ ...redditRoot, id: 'r_wrong', external_id: '123', source: 'r' }).success, false);
});
