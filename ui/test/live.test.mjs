import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPipeline, mapFeedback, mapIssue, watchPipeline } from '../src/data/live.js'
import { sortTags } from '../src/data/constants.js'

const issueId = '11111111-1111-4111-8111-111111111111'
const row = {
  id: issueId, title: 'Stuns last too long', summary: 'Players report lost actions.',
  category: 'feels_bad', target: null, target_type: null, tags: ['combat', 'unknown-tag'],
  feedback_count: 3, source_counts: { reddit: 1, r: 2 }, latest_run: null,
  first_seen_at: '2026-11-14T12:00:00Z', last_seen_at: '2026-11-14T13:00:00Z',
  last_feedback_at: '2026-11-14T12:30:00Z',
}
const feedback = {
  id: 'r_123', source: 'r', kind: 'comment', title: null, body: 'I cannot act.',
  author: 'player', score: 4, postedAt: '2026-11-14T12:30:00Z',
  sourceUrl: 'http://127.0.0.1:5175/post/123', parentId: 'r_122', threadId: 'r_120', numComments: null,
}
const source = { source: 'r', status: 'incomplete', truncated: true, error: 'item cap reached', completed_at: '2026-11-14T13:00:00Z' }
const nextTurn = () => new Promise(resolve => setImmediate(resolve))

function mockFetch(t, detail = { issue: { id: issueId, feedback: [feedback] } }) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init })
    const data = url === '/api/issues' ? { issues: [row] }
      : url === '/api/sources' ? { sources: [source] }
        : url === '/api/capabilities' ? { capabilities: {} }
          : url === `/api/issues/${issueId}/runs` ? { runs: [] } : detail
    return new Response(JSON.stringify(data), { status: detail === null && url === `/api/issues/${issueId}` ? 404 : 200 })
  })
  return calls
}

test('maps real Discovery counts, UUIDs, R sources, dates and unknown tags without invented metrics', () => {
  const issue = mapIssue(row)
  assert.equal(issue.id, issueId)
  assert.equal(issue.mentions, 3)
  assert.deepEqual(issue.sources, { reddit: 1, x: 2 })
  assert.equal(issue.stage, 'feedback')
  assert.equal(issue.statusLabel, 'Discovered')
  assert.equal(issue.lastMention, row.last_feedback_at)
  assert.deepEqual(issue.trend, [])
  assert.equal(issue.stat, undefined)
  assert.equal(issue.run, undefined)
  assert.deepEqual(sortTags(row.tags), row.tags)
})

test('only persisted human decisions close issues; failures and unknown states stay visible', () => {
  const run = { id: 'run-id', stage: 'design', status: 'specing', decision: null }
  assert.equal(mapIssue({ ...row, latest_run: run }).stage, 'spec')
  assert.equal(mapIssue({ ...row, latest_run: { ...run, stage: 'simulation', status: 'verifying' } }).stage, 'playtest')
  for (const status of ['review', 'done']) {
    const issue = mapIssue({ ...row, latest_run: { ...run, status } })
    assert.equal(issue.stage, 'playtest')
    assert.equal(issue.status, 'needs_review')
  }
  for (const status of ['failed', 'interrupted']) {
    const issue = mapIssue({ ...row, latest_run: { ...run, status } })
    assert.equal(issue.stage, 'spec')
    assert.equal(issue.status, 'error')
  }
  assert.equal(mapIssue({ ...row, latest_run: { ...run, status: 'future-state' } }).status, 'unknown')
  const accepted = mapIssue({ ...row, latest_run: { ...run, decision: 'accept' } })
  assert.equal(accepted.stage, 'verified')
  assert.equal(accepted.statusLabel, 'Accepted')
  const rejected = mapIssue({ ...row, latest_run: { ...run, decision: 'reject' } })
  assert.equal(rejected.stage, 'verified')
  assert.equal(rejected.dismissed, false)
  const triageRejected = mapIssue({ ...row, triage_state: 'dismissed' })
  assert.equal(triageRejected.stage, 'verified')
  assert.equal(triageRejected.dismissed, true)
  assert.equal(triageRejected.statusLabel, 'Rejected issue')
  assert.equal(mapIssue({ ...row, latest_run: { ...run, stage: 'spec_rejected', phase: 'spec_rejected' } }).stage, 'feedback')
})

test('explicit specification phases stay in Development before generic status fallbacks', () => {
  for (const phase of ['spec_queued', 'spec_review', 'spec_failed']) {
    for (const status of ['queued', 'specing', 'review', 'verifying', 'done', 'failed', 'interrupted']) {
      const issue = mapIssue({ ...row, latest_run: { id: 'run-id', stage: 'simulation', phase, status } })
      assert.equal(issue.stage, 'spec', `${phase} with ${status}`)
    }
  }
  const review = mapIssue({ ...row, latest_run: { id: 'run-id', stage: 'spec_review', phase: 'spec_review', status: 'review' } })
  assert.equal(review.status, 'needs_review')
  assert.equal(review.statusLabel, 'Awaiting spec review')
})

test('simulation phases stay in Testing and finalized decisions still close issues', () => {
  for (const [phase, status] of [['simulation_queued', 'verifying'], ['simulation_review', 'review'], ['failed', 'failed']]) {
    const issue = mapIssue({ ...row, latest_run: {
      id: 'run-id', stage: 'design', phase, status, approvedSpecVersionId: 'spec-id',
    } })
    assert.equal(issue.stage, 'playtest', phase)
    if (phase === 'simulation_review') assert.equal(issue.statusLabel, 'Awaiting human decision')
  }
  for (const phase of ['accepted', 'experiment_rejected']) {
    assert.equal(mapIssue({ ...row, latest_run: { id: 'run-id', stage: phase, phase, status: 'done' } }).stage, 'verified')
  }
  for (const decision of ['accept', 'reject']) {
    assert.equal(mapIssue({ ...row, latest_run: {
      id: 'run-id', stage: 'spec_review', phase: 'spec_review', status: 'review', decision,
    } }).stage, 'verified')
  }
})

test('real reply text, source links, and thread context survive mapping; unsafe links do not', () => {
  const mapped = mapFeedback(feedback)
  assert.equal(mapped.source, 'x')
  assert.equal(mapped.text, feedback.body)
  assert.equal(mapped.parentId, 'r_122')
  assert.equal(mapped.threadId, 'r_120')
  assert.equal(mapped.engagement.likes, 4)
  assert.equal(mapped.engagement.replies, null)
  assert.equal(mapped.sourceUrl, feedback.sourceUrl)
  assert.equal(mapFeedback({ ...feedback, sourceUrl: 'javascript:alert(1)' }).sourceUrl, null)
  assert.equal(mapFeedback({ ...feedback, sourceUrl: 'https://user:secret@example.com' }).sourceUrl, null)
})

test('loads the board, source status and selected evidence without credentials or N+1 detail reads', async t => {
  const calls = mockFetch(t)
  const result = await loadPipeline(issueId, new AbortController().signal)
  assert.deepEqual(calls.map(call => call.url), ['/api/issues', '/api/sources', `/api/issues/${issueId}`, '/api/capabilities', `/api/issues/${issueId}/runs`])
  assert.ok(calls.every(call => call.init.cache === 'no-store' && !call.init.headers.Authorization))
  assert.equal(result.issues[0].feedback[0].id, feedback.id)
  assert.equal(result.sourceStatus.x.state, 'incomplete')
  assert.equal(result.sourceStatus.x.truncated, true)
})

test('board reads do not fetch every issue detail and 404 detail does not replace the board with seeds', async t => {
  const calls = mockFetch(t, null)
  const board = await loadPipeline(undefined, new AbortController().signal)
  assert.equal(calls.length, 3)
  assert.equal(board.issues[0].feedback, undefined)
  const result = await loadPipeline(issueId, new AbortController().signal)
  assert.equal(result.issues[0].feedback, null)
})

test('network, malformed and unauthorized responses fail visibly rather than returning prototype data', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }))
  await assert.rejects(loadPipeline(undefined, new AbortController().signal), /HTTP 503/)
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }))
  await assert.rejects(loadPipeline(undefined, new AbortController().signal), /invalid tracker response/)
  assert.throws(() => mapIssue({ ...row, source_counts: { r: '2' } }), /invalid tracker response/)
  assert.throws(() => mapFeedback({ ...feedback, source: 'unknown' }), /invalid tracker response/)
})

test('tracker errors identify the failed endpoint and backend validation details', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    error: 'invalid_request', details: [{ path: ['created_at'], message: 'Invalid ISO datetime' }],
  }), { status: 400 }))
  await assert.rejects(loadPipeline(undefined, new AbortController().signal), error => {
    assert.match(error.message, /Tracker API \/issues returned HTTP 400: created_at: Invalid ISO datetime/)
    assert.doesNotMatch(error.message, /backend is running/)
    return true
  })
  t.mock.method(globalThis, 'fetch', async () => new Response('Bad Gateway', { status: 502 }))
  await assert.rejects(loadPipeline(undefined, new AbortController().signal), /\/issues returned HTTP 502/)
})

test('polling serializes requests and cancellation suppresses stale results and future polls', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release
  const gate = new Promise(resolve => { release = resolve })
  let calls = 0
  let updates = 0
  let errors = 0
  t.mock.method(globalThis, 'fetch', async url => {
    calls++
    await gate
    return new Response(JSON.stringify(url === '/api/issues' ? { issues: [row] } : { sources: [] }))
  })
  const stop = watchPipeline(undefined, () => { updates++ }, () => { errors++ })
  assert.equal(calls, 3)
  t.mock.timers.tick(15000)
  assert.equal(calls, 3)
  stop()
  release()
  await nextTurn()
  t.mock.timers.tick(15000)
  assert.equal(calls, 3)
  assert.equal(updates, 0)
  assert.equal(errors, 0)
})

test('polling refreshes every five seconds after completion and retains a visible error callback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let failed = true
  let updates = 0
  let errors = 0
  t.mock.method(globalThis, 'fetch', async url => {
    if (failed) throw new Error('offline')
    return new Response(JSON.stringify(url === '/api/issues' ? { issues: [row] } : { sources: [] }))
  })
  const stop = watchPipeline(undefined, () => { updates++ }, () => { errors++ })
  try {
    await nextTurn()
    assert.equal(errors, 1)
    failed = false
    t.mock.timers.tick(4999)
    await nextTurn()
    assert.equal(updates, 0)
    t.mock.timers.tick(1)
    await nextTurn()
    assert.equal(updates, 1)
  } finally { stop() }
})
