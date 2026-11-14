import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePipeline } from '../store/pipeline'
import { DEVS, GAMES, SOURCES, STAGES } from '../data/constants'
import { Sparkline } from '../components/evidence'
import { Sources, StatusBadge } from '../components/badges'
import { Button, Menu, MenuItem, StateView } from '../components/ui'
import { num, trendScore } from '../components/format'
import { Select } from './Board'

const SORTS = {
  popular: ['Most popular', (a, b) => b.mentions - a.mentions],
  trending: ['Trending', (a, b) => trendScore(b.trend) - trendScore(a.trend)],
  newest: ['Newest', (a, b) => new Date(b.firstSeen) - new Date(a.firstSeen)],
  recent: ['Most recent mention', (a, b) => new Date(b.lastMention) - new Date(a.lastMention)],
}
const RANGES = { all: ['Any time', Infinity], '24h': ['24 hours', 24], '7d': ['7 days', 168], '30d': ['30 days', 720] }
const NO_FILTERS = { source: 'all', dev: 'all', stage: 'all', range: 'all', game: 'all' }

function Row({ issue, rank, others }) {
  const { dispatch } = usePipeline()
  const navigate = useNavigate()
  const [merging, setMerging] = useState(false)
  const triage = issue.stage === 'feedback' && !issue.run

  return (
    <li className={`py-5 ${issue.dismissed ? 'opacity-50' : ''}`}>
      <div className="grid grid-cols-[2rem_1fr_auto] items-start gap-x-4">
        <span className="pt-0.5 font-mono text-sm text-muted">{rank}</span>
        <div className="min-w-0">
          <Link to={`/issues/${issue.id}`} className="font-semibold leading-snug hover:underline">{issue.title}</Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Sources sources={issue.sources} />
            {(issue.stage !== 'feedback' || issue.status !== 'queued') && issue.status !== 'needs_review' ? <StatusBadge status={issue.status} /> : null}
            {issue.dismissed && <span className="text-xs text-muted">Rejected</span>}
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="hidden w-20 text-right sm:block">
            <div className="text-lg font-bold leading-none tabular-nums">{num(issue.mentions)}</div>
            <div className="mt-1 text-xs text-muted">mentions</div>
          </div>
          <span className="hidden md:block"><Sparkline data={issue.trend} /></span>
          <div className="flex w-48 justify-end">
          {triage && !issue.dismissed && !(issue.devs ?? []).length ? (
              <Button size="sm" variant="ghost" to={`/issues/${issue.id}`} title="Select at least one developer before pushing to development.">
                Assign a dev →
              </Button>
            ) : triage && !issue.dismissed ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  dispatch({ type: 'SEND_TO_SPEC', id: issue.id })
                  navigate(`/issues/${issue.id}/spec`)
                }}
              >
                Push to development
              </Button>
            ) : (
              <Button size="sm" variant="ghost" to={`/issues/${issue.id}`}>Open →</Button>
            )}
          </div>
          <Menu label={`Actions for ${issue.title}`}>
            <MenuItem disabled={!triage} onClick={() => setMerging(true)}>Mark as duplicate / merge…</MenuItem>
            {issue.dismissed ? (
              <MenuItem onClick={() => dispatch({ type: 'RESTORE', id: issue.id })}>Restore</MenuItem>
            ) : (
              <MenuItem disabled={!triage} onClick={() => dispatch({ type: 'DISMISS', id: issue.id })}>Reject issue</MenuItem>
            )}
          </Menu>
        </div>
      </div>
      {merging && (
        <div className="ml-12 mt-3 flex items-center gap-3">
          <select
            autoFocus
            aria-label="Merge into issue"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) dispatch({ type: 'MERGE', id: issue.id, intoId: e.target.value })
              setMerging(false)
            }}
            className="select-pill max-w-md"
          >
            <option value="">Merge into…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>{o.title}</option>
            ))}
          </select>
          <Button variant="ghost" onClick={() => setMerging(false)}>Cancel</Button>
        </div>
      )}
    </li>
  )
}

export default function List() {
  const { state, dispatch } = usePipeline()
  const [sort, setSort] = useState('popular')
  const [f, setF] = useState(NO_FILTERS)
  // Date filters compare against when the page opened (read once, not on every render).
  const [now] = useState(() => Date.now())
  const [showFilters, setShowFilters] = useState(false)
  const [showDismissed, setShowDismissed] = useState(false)
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }))
  const activeFilters = Object.entries(f).filter(([, v]) => v !== 'all').length

  const visible = state.issues.filter((i) => !i.mergedInto)
  const list = useMemo(() => {
    const cutoff = now - RANGES[f.range][1] * 3600 * 1000
    return visible
      .filter((i) => showDismissed || !i.dismissed)
      .filter((i) => f.source === 'all' || i.sources[f.source] > 0)
      .filter((i) => f.dev === 'all' || (f.dev === 'none' ? !(i.devs ?? []).length : (i.devs ?? []).includes(f.dev)))
      .filter((i) => f.stage === 'all' || i.stage === f.stage)
      .filter((i) => f.game === 'all' || i.game === f.game)
      .filter((i) => f.range === 'all' || new Date(i.lastMention).getTime() >= cutoff)
      .sort(SORTS[sort][1])
  }, [visible, sort, f, showDismissed, now])

  const failing = Object.entries(state.sourceStatus).filter(([, s]) => s.state === 'error')

  return (
    <>
      <h1 className="sr-only">List</h1>

      {failing.map(([k, s]) => (
        <div key={k} role="alert" className="mb-6 flex items-center gap-4 border-l-2 border-warning py-1 pl-4 text-sm">
          <span className="flex-1">
            <span className="font-semibold text-warning">{SOURCES[k].label} scraper failing.</span> <span className="text-muted">{s.message}</span>
          </span>
          <Button size="sm" onClick={() => dispatch({ type: 'SOURCE_RETRY', source: k })}>Retry</Button>
        </div>
      ))}
      {Object.entries(state.sourceStatus)
        .filter(([, s]) => s.state === 'retrying')
        .map(([k]) => (
          <p key={k} className="mb-6 animate-pulse-soft text-sm text-muted" role="status">Reconnecting to {SOURCES[k].label}…</p>
        ))}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Select label="Sort" value={sort} onChange={setSort} options={Object.entries(SORTS).map(([k, v]) => [k, v[0]])} />
        <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)} className="text-sm text-muted hover:text-text">
          Filters{activeFilters ? ` · ${activeFilters}` : ''} {showFilters ? '▴' : '▾'}
        </button>
        {activeFilters > 0 && <Button variant="ghost" onClick={() => setF(NO_FILTERS)}>Clear</Button>}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} className="accent-accent" />
          Show rejected
        </label>
      </div>
      {showFilters && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3">
          <Select label="Source" value={f.source} onChange={set('source')} options={[['all', 'All'], ...Object.entries(SOURCES).map(([k, v]) => [k, v.label])]} />
          <Select label="Dev" value={f.dev} onChange={set('dev')} options={[['all', 'All'], ['none', 'Unassigned'], ...Object.keys(DEVS).map((k) => [k, DEVS[k].name])]} />
          <Select label="Stage" value={f.stage} onChange={set('stage')} options={[['all', 'All'], ...STAGES.map((s) => [s.id, s.label])]} />
          <Select label="Last mention" value={f.range} onChange={set('range')} options={Object.entries(RANGES).map(([k, v]) => [k, v[0]])} />
          <Select label="Game" value={f.game} onChange={set('game')} options={[['all', 'All'], ...GAMES.map((g) => [g, g])]} />
        </div>
      )}

      {!state.issues.length ? (
        <StateView kind="loading" title="No issues yet — ingestion starting">The list fills in as the Collector clusters the first posts.</StateView>
      ) : list.length === 0 ? (
        <StateView kind="empty" title="No issues match these filters" action={<Button onClick={() => setF(NO_FILTERS)}>Clear filters</Button>} />
      ) : (
        <ol className="mt-2 divide-y divide-border">
          {list.map((issue, i) => (
            <Row key={issue.id} issue={issue} rank={i + 1} others={visible.filter((o) => o.id !== issue.id && !o.dismissed)} />
          ))}
        </ol>
      )}
    </>
  )
}
