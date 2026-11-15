const POLL_MS = 5000
const SOURCE_KEY = { reddit: 'reddit', r: 'x' }
const TESTING_STAGES = new Set(['verification', 'verifying', 'simulation', 'evaluation', 'review', 'done'])
const RUN_STATUSES = new Set(['queued', 'collecting', 'gating', 'specing', 'implementing', 'verifying', 'interrupted', 'review', 'done', 'failed'])

function requireValue(condition) {
  if (!condition) throw new Error('The backend returned an invalid tracker response.')
}

export function mapIssue(row) {
  requireValue(row && typeof row.id === 'string' && typeof row.title === 'string' && typeof row.summary === 'string')
  requireValue(Number.isInteger(row.feedback_count) && row.feedback_count >= 0 && Array.isArray(row.tags))
  requireValue(row.tags.every(tag => typeof tag === 'string'))
  const sources = {}
  for (const [source, key] of Object.entries(SOURCE_KEY)) {
    const count = row.source_counts?.[source]
    requireValue(Number.isInteger(count) && count >= 0)
    sources[key] = count
  }
  const run = row.latest_run ?? null
  if (run) requireValue(typeof run.id === 'string' && typeof run.stage === 'string' && typeof run.status === 'string')
  const decision = run?.decision
  let stage = run ? (TESTING_STAGES.has(run.stage) || ['verifying', 'review', 'done'].includes(run.status) ? 'playtest' : 'spec') : 'feedback'
  let status = !run || run.status === 'queued' ? 'queued' : 'running'
  let statusLabel = run ? run.stage : 'Discovered'
  if (decision === 'accept' || decision === 'reject') {
    stage = 'verified'
    status = decision === 'accept' ? 'done' : 'rejected'
    statusLabel = decision === 'accept' ? 'Accepted' : 'Rejected'
  } else if (run && !RUN_STATUSES.has(run.status)) {
    status = 'unknown'
    statusLabel = `Unknown state: ${run.status}`
  } else if (['failed', 'interrupted'].includes(run?.status)) {
    status = 'error'
    statusLabel = `${run.status} · ${run.stage}`
  } else if (['review', 'done'].includes(run?.status)) {
    status = 'needs_review'
    statusLabel = 'Awaiting human decision'
  }
  return {
    id: row.id, title: row.title, summary: row.summary, category: row.category,
    target: row.target, targetType: row.target_type, tags: row.tags,
    mentions: row.feedback_count, sources, firstSeen: row.first_seen_at,
    lastMention: row.last_feedback_at ?? row.last_seen_at,
    stage, status, statusLabel, backendRun: run, dismissed: decision === 'reject',
    // No prototype run scripts, invented trends, assignments, or gameplay statistics.
    devs: [], trend: [], mergedInto: null,
  }
}

function sourceLink(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function mapFeedback(row) {
  requireValue(row && typeof row.id === 'string' && SOURCE_KEY[row.source] && typeof row.body === 'string')
  requireValue(typeof row.author === 'string' && Number.isInteger(row.score) && typeof row.postedAt === 'string')
  return {
    id: row.id, source: SOURCE_KEY[row.source], kind: row.kind,
    text: [row.title, row.body].filter(Boolean).join('\n\n'),
    author: row.author, ts: row.postedAt, sourceUrl: sourceLink(row.sourceUrl),
    parentId: row.parentId, threadId: row.threadId,
    engagement: { likes: row.score, replies: row.numComments ?? null },
  }
}

async function get(path, signal, allowMissing = false) {
  const response = await fetch(`/api${path}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    headers: { Accept: 'application/json' }, cache: 'no-store',
  })
  if (allowMissing && response.status === 404) return null
  if (!response.ok) throw new Error(`Tracker API returned HTTP ${response.status}. Check that the backend is running.`)
  return response.json()
}

export async function loadPipeline(issueId, signal) {
  const [board, sources, detail] = await Promise.all([
    get('/issues', signal), get('/sources', signal),
    issueId ? get(`/issues/${encodeURIComponent(issueId)}`, signal, true) : null,
  ])
  requireValue(Array.isArray(board.issues) && Array.isArray(sources.sources))
  const issues = board.issues.map(mapIssue)
  if (detail) requireValue(detail.issue?.id === issueId && Array.isArray(detail.issue.feedback))
  const selected = issues.find(item => item.id === issueId)
  if (selected) selected.feedback = detail ? detail.issue.feedback.map(mapFeedback) : null
  const sourceStatus = {}
  for (const row of sources.sources) {
    const key = SOURCE_KEY[row.source]
    requireValue(key && typeof row.status === 'string')
    sourceStatus[key] = {
      state: row.status === 'failed' ? 'error' : row.status === 'incomplete' ? 'incomplete' : row.status === 'running' ? 'running' : row.status === 'complete' ? 'ok' : 'unknown',
      status: row.status, message: row.error ?? null,
      startedAt: row.started_at, completedAt: row.completed_at, truncated: row.truncated,
    }
  }
  return { issues, sourceStatus }
}

export function watchPipeline(issueId, onData, onError) {
  const controller = new AbortController()
  let timer
  async function poll() {
    try {
      const state = await loadPipeline(issueId, controller.signal)
      if (!controller.signal.aborted) onData(state)
    } catch (error) {
      if (!controller.signal.aborted) onError(error)
    } finally {
      if (!controller.signal.aborted) timer = setTimeout(poll, POLL_MS)
    }
  }
  void poll()
  return () => { controller.abort(); clearTimeout(timer) }
}
