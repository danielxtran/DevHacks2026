import { useOutletContext } from 'react-router-dom'
import { SubjectTags } from '../components/badges'
import { SourceBrowser } from '../components/evidence'
import { Section, StateView } from '../components/ui'
import { stamp } from '../components/format'

export default function IssueDetail() {
  const { issue } = useOutletContext()
  const run = issue.backendRun

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <p className="max-w-2xl text-lg leading-relaxed">{issue.summary}</p>
        <p className="mt-2 text-xs text-muted">Summary written by Discovery from synthetic, untrusted player feedback. These claims are not gameplay telemetry.</p>
        <div className="mt-5"><SubjectTags issue={issue} editable={false} /></div>
        <Section title="Sources" className="mt-10">
          {issue.feedback === undefined ? <StateView kind="loading" title="Loading saved evidence…" /> : issue.feedback === null ? <StateView kind="empty" title="Saved evidence is unavailable">The backend no longer returns this issue’s evidence.</StateView> : <SourceBrowser key={issue.id} issue={issue} />}
        </Section>
      </div>
      <aside className="space-y-8 text-sm">
        <Section title="Discovery">
          <dl className="space-y-3">
            <div><dt className="text-muted">Category</dt><dd>{issue.category?.replaceAll('_', ' ') ?? 'Unavailable'}</dd></div>
            <div><dt className="text-muted">Target</dt><dd>{issue.target ?? 'Not specified'}</dd></div>
            <div><dt className="text-muted">First discovered</dt><dd>{stamp(issue.firstSeen)}</dd></div>
            <div><dt className="text-muted">Latest feedback</dt><dd>{stamp(issue.lastMention)}</dd></div>
          </dl>
        </Section>
        <Section title="Latest experiment">
          {run ? (
            <dl className="space-y-3">
              <div><dt className="text-muted">Run ID</dt><dd className="break-all font-mono text-xs">{run.id}</dd></div>
              <div><dt className="text-muted">Backend stage</dt><dd>{run.stage}</dd></div>
              <div><dt className="text-muted">Status</dt><dd>{run.status}</dd></div>
              <div><dt className="text-muted">Attempt</dt><dd>{run.attempt}</dd></div>
              {run.error && <div role="alert" className="text-warning">{run.error}</div>}
              {run.decision && <div><dt className="text-muted">Human decision</dt><dd>{run.decision} · {run.reviewer}</dd></div>}
            </dl>
          ) : <p className="text-muted">No experiment has been started for this issue.</p>}
          <p className="mt-4 text-xs text-muted">Read-only tracker. Workflow actions and experiment artifacts are not connected here yet; no progress or results are simulated.</p>
        </Section>
      </aside>
    </div>
  )
}
