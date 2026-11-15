import { Link, Outlet, useParams } from 'react-router-dom'
import { useIssue } from '../store/pipeline'
import { StatusBadge } from '../components/badges'
import { Button, StateView } from '../components/ui'
import { num } from '../components/format'

export default function IssueLayout() {
  const { id } = useParams()
  const issue = useIssue(id)

  if (!issue) {
    return <StateView kind="empty" title="Issue not found" action={<Button to="/">Back to board</Button>}>This issue is not in the backend’s active discovered issues.</StateView>
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        <Link to="/" className="hover:text-text">← Board</Link> · {num(issue.mentions)} feedback items
      </p>
      <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{issue.title}</h1>
      <div className="mt-5 border-b border-border pb-5">
        <StatusBadge status={issue.status} label={issue.statusLabel} />
      </div>
      <div className="pt-10"><Outlet context={{ issue }} /></div>
    </div>
  )
}
