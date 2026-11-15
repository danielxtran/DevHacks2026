import { Link, Outlet, useLocation, useParams } from 'react-router-dom'
import { useIssue } from '../store/pipeline'
import { StatusBadge } from '../components/badges'
import { Button, StateView } from '../components/ui'
import { num } from '../components/format'

const steps = [
  ['feedback', 'Issues', ''],
  ['spec', 'Development', '/spec'],
  ['results', 'Results', '/results'],
]

export default function IssueLayout() {
  const { id } = useParams()
  const { pathname, search } = useLocation()
  const issue = useIssue(id)

  if (!issue) {
    return <StateView kind="empty" title="Issue not found" action={<Button to="/">Back to board</Button>}>This issue is not in the backend’s active discovered issues.</StateView>
  }

  const selectedRunId = new URLSearchParams(search).get('run') ?? issue.backendRun?.id
  const query = new URLSearchParams(search)
  if (selectedRunId) query.set('run', selectedRunId)
  const runQuery = query.size ? `?${query}` : ''
  const currentStage = ['playtest', 'verified'].includes(issue.stage) ? 'results' : issue.stage
  const current = steps.findIndex(([stage]) => stage === currentStage)

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        <Link to="/" className="hover:text-text">← Board</Link> · {num(issue.mentions)} feedback items
      </p>
      <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{issue.title}</h1>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <StatusBadge status={issue.status} label={issue.statusLabel} />
        <nav aria-label="Workflow stages" className="flex flex-wrap gap-1">
          {steps.map(([stage, label, suffix], index) => {
            const active = suffix === '' ? pathname.endsWith(`/issues/${id}`) : pathname.endsWith(suffix)
            return <Link key={stage} aria-current={active ? 'step' : undefined}
              className={`rounded-full px-3 py-1.5 text-xs ${active ? 'bg-accent text-white' : index < current ? 'text-text' : 'text-muted hover:bg-surface-2 hover:text-text'}`}
              to={`/issues/${id}${suffix}${runQuery}`}>{label}</Link>
          })}
        </nav>
      </div>
      {issue.mergedInto && <p className="mt-4 text-sm text-warning">This issue was merged. <Link className="underline" to={`/issues/${issue.mergedInto}`}>Open the canonical issue</Link>; this record retains its evidence and history.</p>}
      <div className="pt-10"><Outlet context={{ issue }} /></div>
    </div>
  )
}
