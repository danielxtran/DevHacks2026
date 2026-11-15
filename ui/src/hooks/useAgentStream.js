import { useEffect, useState } from 'react'
import { useIssue } from '../store/pipeline'
import { AGENTS } from '../data/constants'

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/**
 * Live view of the agent working on an issue.
 *
 * Today this reads the simulated run from the pipeline store. To go live,
 * swap the body for an EventSource / WebSocket subscription
 * (e.g. new EventSource(`/api/issues/${issueId}/stream`)) that returns the
 * same shape: { running, agent, lines, current, elapsedMs, progress }.
 */
export function useAgentStream(issueId) {
  const issue = useIssue(issueId)
  const now = useNow(1000)
  const run = issue?.run
  if (!run) return { running: false, agent: null, lines: [], current: null, elapsedMs: 0, progress: 0 }
  const lines = run.script.slice(0, run.idx)
  return {
    running: true,
    agent: AGENTS[run.agent],
    kind: run.kind,
    lines,
    current: run.script[Math.min(run.idx, run.script.length - 1)],
    elapsedMs: Math.max(0, now - new Date(run.startedAt).getTime()),
    progress: run.idx / run.script.length,
    indeterminate: run.kind === 'simulation',
  }
}
