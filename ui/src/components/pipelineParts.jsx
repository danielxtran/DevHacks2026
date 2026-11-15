import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { STAGES, STAGE_INDEX, STATUSES } from '../data/constants'
import { useAgentStream } from '../hooks/useAgentStream'
import { Button } from './ui'
import { duration, stamp } from './format'

const STAGE_ROUTE = { feedback: '', spec: '/spec', playtest: '/playtest', verified: '/verified' }

/** Feedback → Spec → Build → Playtest → Verified. Doubles as the issue's page navigation. */
export function StageStepper({ issue, current }) {
  const cur = STAGE_INDEX[issue.stage]
  return (
    <nav aria-label="Pipeline stage">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
        {STAGES.map((s, i) => {
          const done = i < cur || issue.status === 'done'
          const active = i === cur && issue.status !== 'done'
          const reachable = i <= cur
          const viewing = current === s.id
          const icon = done ? '✓' : active && issue.status !== 'needs_review' ? STATUSES[issue.status]?.icon : ''
          const tone = active ? 'text-text' : done ? 'text-success' : 'text-muted/60'
          const body = (
            <span className={`relative flex items-center gap-1.5 px-2.5 py-1.5 ${reachable ? 'sel' : ''} ${viewing ? 'is-selected after:absolute after:inset-x-2 after:-bottom-[7px] after:h-[3px] after:rounded-t-sm after:bg-accent' : ''} ${tone}`}>
              {icon && <span aria-hidden className={`font-mono text-xs ${active && issue.status === 'running' ? 'animate-pulse-soft' : ''}`}>{icon}</span>}
              <span className={viewing ? 'font-semibold text-text' : ''}>{s.label}</span>
              {active && issue.run?.agent === 'build' && <span className="text-xs text-muted">· building</span>}
              <span className="sr-only">{done ? '(complete)' : active ? `(current: ${STATUSES[issue.status]?.label})` : '(not started)'}</span>
            </span>
          )
          return (
            <li key={s.id} className="flex items-center gap-1" aria-current={active ? 'step' : undefined}>
              {reachable ? (
                <Link to={`/issues/${issue.id}${STAGE_ROUTE[s.id]}`} className="rounded-md hover:text-text">
                  {body}
                </Link>
              ) : (
                <span>{body}</span>
              )}
              {i < STAGES.length - 1 && <span aria-hidden className="text-muted/50">→</span>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Which agent is working, what it's doing, for how long, plus a streaming log. */
export function AgentActivityPanel({ issueId }) {
  const a = useAgentStream(issueId)
  const logRef = useRef(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [a.lines.length])
  if (!a.running) return null

  return (
    <div className="rounded-md bg-surface px-4 py-3">
      <div className="flex items-center gap-3 text-sm">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-info" />
        <span className="font-semibold">{a.agent.name}</span>
        <span className="min-w-0 flex-1 truncate text-muted" aria-live="polite">{a.current}</span>
        <span className="font-mono text-xs text-muted">{duration(a.elapsedMs)}</span>
      </div>
      <div className="mt-2.5 h-px bg-border" role="progressbar" aria-label={a.indeterminate ? 'Simulation running' : 'Agent progress'} aria-valuenow={a.indeterminate ? undefined : Math.round(a.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-px bg-info ${a.indeterminate ? 'w-full animate-pulse-soft' : 'transition-all duration-500'}`} style={a.indeterminate ? undefined : { width: `${a.progress * 100}%` }} />
      </div>
      {a.lines.length > 0 && (
        <ol ref={logRef} className="mt-2.5 max-h-24 space-y-0.5 overflow-y-auto font-mono text-xs text-muted">
          {a.lines.map((l, i) => (
            <li key={i} className="animate-line-in">
              <span aria-hidden className="text-success">✓</span> {l}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * Human gate: Approve / Request changes / Reject.
 * A comment is required for reject and request-changes; approve can be locked with a reason.
 */
export function ApprovalGate({ approveLabel = 'Approve', onApprove, onRequestChanges, requestLabel = 'Request changes', onReject, rejectLabel = 'Reject', disabled, disabledReason, approval, note }) {
  const [mode, setMode] = useState(null) // null | 'request' | 'reject'
  const [comment, setComment] = useState('')
  const [touched, setTouched] = useState(false)

  if (approval) {
    return (
      <p className="flex items-center gap-2 border-t border-border pt-5 text-sm text-muted">
        <span aria-hidden className="text-success">✓</span>
        Approved by <span className="text-text">{approval.by}</span> · {stamp(approval.ts)}
        {approval.comment ? ` · “${approval.comment}”` : ''}
      </p>
    )
  }

  const reset = () => {
    setMode(null)
    setComment('')
    setTouched(false)
  }
  const confirm = () => {
    setTouched(true)
    if (!comment.trim()) return
    ;(mode === 'reject' ? onReject : onRequestChanges)(comment.trim())
    reset()
  }

  return (
    <div className="space-y-3 border-t border-border pt-5">
      {note}
      {mode ? (
        <div className="space-y-3">
          <label className="block">
            <span className="text-sm">{mode === 'reject' ? 'Why are you rejecting this?' : 'What should the agent change?'}</span>
            <textarea
              autoFocus
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              aria-invalid={touched && !comment.trim()}
              className={`mt-1.5 w-full resize-y rounded-lg border bg-transparent px-3 py-2 text-sm ${touched && !comment.trim() ? 'border-warning' : 'border-border'}`}
            />
            {touched && !comment.trim() && <span className="text-xs text-warning">A comment is required.</span>}
          </label>
          <div className="flex items-center gap-4">
            <Button variant={mode === 'reject' ? 'secondary' : 'primary'} onClick={confirm}>
              {mode === 'reject' ? rejectLabel : 'Send to agent'}
            </Button>
            <Button variant="ghost" onClick={reset}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Button variant="primary" disabled={disabled} onClick={() => onApprove('')} aria-describedby={disabled && disabledReason ? 'gate-reason' : undefined}>
            {approveLabel}
          </Button>
          {onRequestChanges && <Button variant="ghost" onClick={() => setMode('request')}>{requestLabel}</Button>}
          {onReject && <Button variant="danger" onClick={() => setMode('reject')}>{rejectLabel}</Button>}
        </div>
      )}
      {!mode && disabled && disabledReason && (
        <p id="gate-reason" className="text-sm text-muted">
          <span aria-hidden className="text-warning">! </span>
          {disabledReason}
        </p>
      )}
    </div>
  )
}

export function AuditTrail({ issue }) {
  return (
    <ol className="space-y-2">
      {[...issue.audit].reverse().map((a, i) => (
        <li key={i} className="grid grid-cols-[7.5rem_1fr] gap-3 text-sm">
          <time className="font-mono text-xs text-muted" dateTime={a.ts}>{stamp(a.ts)}</time>
          <span>
            <span className={a.kind === 'agent' ? 'text-info' : 'text-text'}>{a.actor}</span>
            <span className="text-muted"> ({a.kind}) · {a.text}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
