import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { usePipeline } from '../store/pipeline'
import { DEVS } from '../data/constants'
import { SourceBrowser } from '../components/evidence'
import { AssigneeChecklist, SubjectTags } from '../components/badges'
import { MentionTrend } from '../components/charts'
import { AgentActivityPanel, AuditTrail } from '../components/pipelineParts'
import { Button, ErrorPanel, Section } from '../components/ui'
import { stamp, timeAgo } from '../components/format'

function StatSanityCheck({ issue }) {
  const s = issue.stat
  const t = issue.change.metric.target
  const outside = s.value < t[0] || s.value > t[1]
  return (
    <div>
      <h2 className="text-sm text-muted">Does live data back this up?</h2>
      <p className="mt-2 text-4xl font-bold tracking-tight tabular-nums">
        {s.value}
        <span className="text-2xl">{s.unit}</span>
      </p>
      <p className="text-sm text-muted">
        {s.label} · healthy range {t[0]}–{t[1]}{s.unit}
      </p>
      <p className="mt-3 text-sm">
        <span aria-hidden className={outside ? 'text-accent-text' : 'text-warning'}>{outside ? '▲ ' : '≈ '}</span>
        {outside ? 'Yes. It’s outside the healthy range.' : 'Not clearly. It’s inside the healthy range.'}
      </p>
      <p className="mt-1 text-xs text-muted">{s.note}</p>
    </div>
  )
}

function mentions(text) {
  return text.split(/(@\w+)/g).map((part, i) =>
    part.startsWith('@') && DEVS[part.slice(1).toLowerCase()] ? (
      <span key={i} className="font-semibold text-text">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

function Discussion({ issue }) {
  const { dispatch } = usePipeline()
  const [text, setText] = useState('')
  return (
    <Section title="Discussion" className="mt-12">
      <ul className="space-y-4">
        {issue.comments.map((c) => (
          <li key={c.id} className="text-sm">
            <span className="font-semibold">{c.author}</span> <span className="text-xs text-muted">{timeAgo(c.ts)}</span>
            <p className="mt-0.5 leading-relaxed">{mentions(c.text)}</p>
          </li>
        ))}
        {!issue.comments.length && <li className="text-sm text-muted">No comments yet.</li>}
      </ul>
      <form
        className="mt-5 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          dispatch({ type: 'COMMENT', id: issue.id, text: text.trim() })
          setText('')
        }}
      >
        <label htmlFor="comment" className="sr-only">Comment</label>
        <input id="comment" value={text} onChange={(e) => setText(e.target.value)} placeholder="Comment, or loop in a dev with @Marco, @Ana…" className="h-10 flex-1 rounded-lg border border-border bg-transparent px-3 text-sm placeholder:text-muted/70" />
        <Button type="submit" disabled={!text.trim()}>Post</Button>
      </form>
    </Section>
  )
}

/** Reject an untriaged issue. Takes it off the Issues column; a reason is required. */
function RejectIssue({ issue }) {
  const { dispatch } = usePipeline()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)

  if (issue.dismissed) {
    return (
      <div className="text-sm">
        <p><span aria-hidden className="text-accent-text">✕ </span>Rejected by {issue.rejection?.by ?? 'a reviewer'}{issue.rejection?.ts ? ` · ${stamp(issue.rejection.ts)}` : ''}</p>
        {issue.rejection?.comment && <p className="mt-1 text-muted">“{issue.rejection.comment}”</p>}
        <Button variant="ghost" onClick={() => dispatch({ type: 'RESTORE', id: issue.id })}>Restore issue</Button>
      </div>
    )
  }
  if (!open) {
    return <Button variant="danger" onClick={() => setOpen(true)}>Reject issue</Button>
  }
  const submit = (e) => {
    e.preventDefault()
    setTouched(true)
    if (!reason.trim()) return
    dispatch({ type: 'DISMISS', id: issue.id, comment: reason.trim() })
    navigate('/')
  }
  // Solid red "Are you sure?" block (spec 3.1 / 6.2.1), the most serious moment on the page.
  return (
    <form onSubmit={submit} role="alertdialog" aria-labelledby="reject-title" aria-describedby="reject-desc" className="space-y-3 rounded-lg bg-accent p-4 text-white">
      <p id="reject-title" className="font-display text-lg font-bold">Are you sure?</p>
      <p id="reject-desc" className="text-sm text-white/90">This takes the issue off the Issues column for the whole team and moves it to Closed. You can restore it later.</p>
      <label className="block">
        <span className="text-sm font-semibold">Why are you rejecting this issue?</span>
        <textarea
          autoFocus
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={touched && !reason.trim()}
          placeholder="e.g. Working as intended"
          className={`mt-1.5 w-full resize-y rounded-md border bg-black/15 px-3 py-2 text-sm text-white placeholder:text-white/60 ${touched && !reason.trim() ? 'border-white' : 'border-white/40'}`}
        />
        {touched && !reason.trim() && <span className="text-xs font-semibold">! A reason is required.</span>}
      </label>
      <div className="flex items-center gap-4">
        <button type="submit" className="h-9 rounded-full bg-white px-5 text-sm font-bold text-[#b8292d] hover:bg-white/90">Reject issue</button>
        <button type="button" className="text-sm font-semibold text-white/90 hover:text-white" onClick={() => { setOpen(false); setReason(''); setTouched(false) }}>Cancel</button>
      </div>
    </form>
  )
}

export default function IssueDetail() {
  const { issue } = useOutletContext()
  const { dispatch } = usePipeline()
  const navigate = useNavigate()
  const canGenerate = issue.stage === 'feedback' && !issue.run && !issue.dismissed && !issue.mergedInto
  const hasDev = (issue.devs ?? []).length > 0

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        {issue.error && <div className="mb-8"><ErrorPanel error={issue.error} onRetry={() => dispatch({ type: 'RETRY_RUN', id: issue.id })} /></div>}
        <p className="max-w-2xl text-lg leading-relaxed">{issue.summary}</p>
        <p className="mt-2 text-xs text-muted">Summary written by the Collector agent. Check it against the posts below.</p>
        <div className="mt-5">
          <h2 className="sr-only">Tags</h2>
          <SubjectTags issue={issue} editable={issue.stage === 'feedback' && !issue.dismissed} />
        </div>

        <Section title="Sources" className="mt-10">
          <SourceBrowser issue={issue} />
        </Section>

        <Section className="mt-10">
          <MentionTrend trend={issue.trend} />
        </Section>

        <Discussion issue={issue} />

        <details className="mt-12 border-t border-border pt-5">
          <summary className="cursor-pointer font-display text-lg font-bold tracking-tight">Activity log <span className="text-sm font-normal text-muted">· {issue.audit.length}</span></summary>
          <div className="mt-4"><AuditTrail issue={issue} /></div>
        </details>
      </div>

      <aside className="space-y-10">
        <AgentActivityPanel issueId={issue.id} />
        {canGenerate ? (
          <div>
            <Button
              variant="primary"
              className="w-full"
              disabled={!hasDev}
              title={hasDev ? undefined : 'Select at least one developer.'}
              aria-describedby="push-dev-note"
              onClick={() => {
                dispatch({ type: 'SEND_TO_SPEC', id: issue.id })
                navigate(`/issues/${issue.id}/spec`)
              }}
            >
              Push to development →
            </Button>
            <p id="push-dev-note" className="mt-2 text-xs text-muted">
              {!hasDev ? (
                <><span aria-hidden className="text-warning">! </span>Select at least one developer below.</>
              ) : (
                <>{issue.status === 'rejected' ? 'The last spec was rejected. ' : ''}The agent writes the first spec. You review and edit it before anything is built.</>
              )}
            </p>
            <div className="mt-4"><RejectIssue issue={issue} /></div>
          </div>
        ) : issue.dismissed ? (
          <RejectIssue issue={issue} />
        ) : issue.stage !== 'feedback' && !issue.run ? (
          <Button to={`/issues/${issue.id}/${issue.stage}`} className="w-full">
            Go to {issue.stage === 'verified' ? 'result' : issue.stage} →
          </Button>
        ) : null}
        <StatSanityCheck issue={issue} />
        <AssigneeChecklist issue={issue} />
      </aside>
    </div>
  )
}
