import { useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { usePipeline } from '../store/pipeline'
import { DEVS, devLabel } from '../data/constants'
import { SubjectTags } from '../components/badges'
import { SourceBrowser } from '../components/evidence'
import { Button, Section, StateView } from '../components/ui'

const actor = 'You'
const field = 'mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm'

function IssueControls({ issue }) {
  const { state, command } = usePipeline()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [draftRevision, setDraftRevision] = useState(null)
  const [reason, setReason] = useState('')
  const [canonicalId, setCanonicalId] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [startKey, setStartKey] = useState(null)
  const merged = issue.triageState === 'merged'
  const openIssues = state.issues.filter(item => item.id !== issue.id && item.triageState === 'open')

  const beginEdit = () => {
    setDraft({ title: issue.title, tags: (issue.tags ?? []).join(', '), developer: issue.assignedDeveloper ?? '' })
    setDraftRevision(issue.revision)
    setEditing(true)
    setError(null)
  }
  const submit = async action => {
    setBusy(true)
    setError(null)
    try { await action() } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  const metadata = async event => {
    event.preventDefault()
    await submit(async () => {
      await command(`/issues/${issue.id}`, 'PATCH', {
        expectedRevision: draftRevision, actor,
        title: draft.title.trim(), tags: draft.tags.split(',').map(tag => tag.trim()).filter(Boolean),
        developer: draft.developer || null,
      })
      setEditing(false)
    })
  }
  const start = async () => {
    const key = startKey ?? crypto.randomUUID()
    if (!startKey) setStartKey(key)
    await submit(async () => {
      try {
        const result = await command(`/issues/${issue.id}/runs`, 'POST', { idempotencyKey: key, actor })
        setStartKey(null)
        navigate(`/issues/${issue.id}/spec?run=${encodeURIComponent(result.run.id)}`)
      } catch (failure) {
        if (/^\d{3}:/.test(failure.message)) setStartKey(null)
        throw failure
      }
    })
  }
  const toggleDismiss = () => submit(async () => {
    if (issue.triageState === 'dismissed') {
      await command(`/issues/${issue.id}/restore`, 'POST', { expectedRevision: issue.revision, actor })
    } else {
      await command(`/issues/${issue.id}/dismiss`, 'POST', { expectedRevision: issue.revision, actor, reason: reason.trim() })
      setReason('')
    }
  })
  const merge = event => {
    event.preventDefault()
    const target = state.issues.find(item => item.id === canonicalId)
    if (!target) return
    submit(() => command(`/issues/${issue.id}/merge`, 'POST', {
      expectedRevision: issue.revision, expectedCanonicalRevision: target.revision, canonicalIssueId: target.id, actor,
    }))
  }
  const capability = state.capabilities.startExperiment
  const canStart = !merged && issue.triageState !== 'dismissed' && Boolean(issue.assignedDeveloper)
    && ['feedback', 'verified'].includes(issue.stage) && capability?.enabled

  return (
    <aside className="space-y-8 text-sm">
      <Section title="Issue controls">
        {merged ? (
          <p className="text-muted">Merged into <Link className="underline" to={`/issues/${issue.mergedInto}`}>{issue.mergedInto}</Link>. Original evidence and activity remain saved.</p>
        ) : editing ? (
          <form className="space-y-3" onSubmit={metadata}>
            <label className="block">Title<input className={field} maxLength={200} required value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
            <label className="block">Tags (comma-separated)<input className={field} value={draft.tags} onChange={event => setDraft({ ...draft, tags: event.target.value })} /></label>
            <label className="block">Developer<select className={field} value={draft.developer} onChange={event => setDraft({ ...draft, developer: event.target.value })}><option value="">Unassigned</option>{Object.entries(DEVS).map(([id, value]) => <option key={id} value={id}>{value.name}</option>)}</select></label>
            <div className="flex gap-3"><Button type="submit" variant="primary" disabled={busy}>Save</Button><Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
          </form>
        ) : (
          <div className="space-y-3">
            <p>Assigned developer: <strong>{issue.assignedDeveloper ? devLabel(issue.assignedDeveloper) : 'Unassigned'}</strong></p>
            <Button size="sm" onClick={beginEdit} disabled={merged}>Edit title, tags & assignment</Button>
            {issue.triageState === 'dismissed' ? (
              <Button size="sm" onClick={() => void toggleDismiss()} disabled={busy}>Restore issue</Button>
            ) : (
              <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (reason.trim()) void toggleDismiss() }}>
                <label className="block text-xs text-muted">Dismiss reason<input className={field} value={reason} onChange={event => setReason(event.target.value)} required placeholder="Why should this issue be closed?" maxLength={2000} /></label>
                <Button size="sm" variant="danger" type="submit" disabled={busy || !reason.trim()}>Reject issue</Button>
              </form>
            )}
            <form className="space-y-2 border-t border-border pt-3" onSubmit={merge}>
              <label className="block text-xs text-muted">Merge into canonical issue<select className={field} value={canonicalId} onChange={event => setCanonicalId(event.target.value)}><option value="">Select issue</option>{openIssues.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
              <Button size="sm" type="submit" disabled={busy || !canonicalId}>Merge duplicate</Button>
            </form>
            <div className="border-t border-border pt-3">
              <Button size="sm" variant="primary" onClick={() => void start()} disabled={busy || !canStart}>
                Push to development →
              </Button>
              {!canStart && <p className="mt-2 text-xs text-muted">{issue.triageState === 'dismissed' ? 'Restore this issue first.' : !issue.assignedDeveloper ? 'Assign a developer before starting.' : capability?.reason ?? 'An experiment is already active or this issue is closed.'}</p>}
            </div>
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-xs text-warning">{error}</p>}
      </Section>
    </aside>
  )
}

export default function IssueDetail() {
  const { issue } = useOutletContext()
  const { command } = usePipeline()
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const addComment = async event => {
    event.preventDefault()
    const text = comment.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    try {
      await command(`/issues/${issue.id}/comments`, 'POST', { expectedRevision: issue.revision, actor, text })
      setComment('')
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div>
        <p className="max-w-2xl text-lg leading-relaxed">{issue.summary}</p>
        <p className="mt-2 text-xs text-muted">Summary written by Discovery from synthetic, untrusted player feedback. These claims are not gameplay telemetry.</p>
        <div className="mt-5"><SubjectTags issue={issue} editable={false} /></div>
        <Section title="Sources" className="mt-10">
          {issue.feedback === undefined ? <StateView kind="loading" title="Loading saved evidence…" /> : issue.feedback === null ? <StateView kind="empty" title="Saved evidence is unavailable">The backend no longer returns this issue’s evidence.</StateView> : <SourceBrowser key={issue.id} issue={issue} />}
        </Section>
        <form className="mt-6 space-y-2" onSubmit={addComment}>
          <label className="block text-sm" htmlFor="issue-comment">Add a team comment</label>
          <textarea id="issue-comment" rows={3} maxLength={5000} className={field} value={comment} disabled={busy} onChange={event => setComment(event.target.value)} placeholder="Add a team comment" />
          <Button size="sm" type="submit" disabled={busy || !comment.trim()}>Comment</Button>
          {error && <p role="alert" className="text-xs text-warning">{error}</p>}
        </form>
      </div>
      <IssueControls issue={issue} />
    </div>
  )
}
