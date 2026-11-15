import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePipeline } from '../store/pipeline'
import { SOURCES, STAGES } from '../data/constants'
import { Sources, StatusBadge } from '../components/badges'
import { Button, StateView } from '../components/ui'
import { num, timeAgo } from '../components/format'
import { PageTitle, Select } from './Board'

const SORTS = {
  popular: ['Most feedback', (a, b) => b.mentions - a.mentions],
  newest: ['Newest', (a, b) => new Date(b.firstSeen) - new Date(a.firstSeen)],
  recent: ['Most recent feedback', (a, b) => new Date(b.lastMention) - new Date(a.lastMention)],
}

export default function List() {
  const { state } = usePipeline()
  const [sort, setSort] = useState('popular')
  const [source, setSource] = useState('all')
  const [stage, setStage] = useState('all')
  const list = state.issues
    .filter(issue => source === 'all' || issue.sources[source] > 0)
    .filter(issue => stage === 'all' || issue.stage === stage)
    .sort(SORTS[sort][1])

  return (
    <>
      <PageTitle title="Issue List">Current discovered issues and their saved feedback. Counts include posts, comments, and replies—not unique players.</PageTitle>
      <div className="mb-4 flex flex-wrap gap-5">
        <Select label="Sort" value={sort} onChange={setSort} options={Object.entries(SORTS).map(([key, [label]]) => [key, label])} />
        <Select label="Source" value={source} onChange={setSource} options={[['all', 'All'], ...Object.entries(SOURCES).map(([key, value]) => [key, value.label])]} />
        <Select label="Stage" value={stage} onChange={setStage} options={[['all', 'All'], ...STAGES.map(item => [item.id, item.label])]} />
      </div>
      {!state.issues.length ? (
        <StateView kind="empty" title="No discovered issues yet">Saved Discovery groups will appear here automatically.</StateView>
      ) : !list.length ? (
        <StateView kind="empty" title="No issues match these filters" action={<Button onClick={() => { setSource('all'); setStage('all') }}>Clear filters</Button>} />
      ) : (
        <ol className="divide-y divide-border">
          {list.map((issue, index) => (
            <li key={issue.id} className="grid grid-cols-[2rem_1fr_auto] items-start gap-4 py-5">
              <span className="font-mono text-sm text-muted">{index + 1}</span>
              <div className="min-w-0">
                <Link to={`/issues/${issue.id}`} className="font-semibold hover:underline">{issue.title}</Link>
                <p className="mt-1 text-sm text-muted">{issue.summary}</p>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <Sources sources={issue.sources} />
                  <StatusBadge status={issue.status} label={issue.statusLabel} />
                  <span className="text-xs text-muted">Last feedback {timeAgo(issue.lastMention)}</span>
                </div>
              </div>
              <div className="text-right">
                <span className="font-mono">{num(issue.mentions)}</span>
                <p className="text-xs text-muted">feedback items</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
