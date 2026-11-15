import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePipeline } from '../store/pipeline'
import { BOARD, SOURCES, STAGES, TARGETS, sortTags, tagInfo } from '../data/constants'
import { Section, StateView, UpvoteIcon } from '../components/ui'
import { StatusBadge } from '../components/badges'
import { num } from '../components/format'

const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label]))

// Reddit-style time filters, matched against when the issue was first seen (spec 6.1).
const DATES = {
  all: ['All time', Infinity],
  hour: ['Past hour', 1],
  today: ['Today', 24],
  week: ['This week', 24 * 7],
  month: ['This month', 24 * 30],
  year: ['This year', 24 * 365],
}
const EMPTY = { issues: 'No new issues', development: 'No issues in development', testing: 'No issues in testing', closed: 'No closed issues' }
const NO_FILTERS = { platform: 'all', date: 'all', tag: 'all' }

export function PageTitle({ title, children }) {
  return (
    <header className="mb-10">
      <h1 className="font-display text-5xl font-bold">{title}</h1>
      {children && <div className="mt-3 text-muted">{children}</div>}
    </header>
  )
}

/** Pill dropdown. `dot` (a color) shows a colored dot inside the pill, before the selected value. */
export function Select({ label, value, onChange, options, dot }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted">
      {label}
      <span className="relative inline-flex items-center">
        {dot && <span aria-hidden className="pointer-events-none absolute left-3.5 h-2.5 w-2.5 rounded-full" style={{ background: dot }} />}
        <select value={value} onChange={(e) => onChange(e.target.value)} className="select-pill" style={dot ? { paddingLeft: '2.1rem' } : undefined}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </span>
    </label>
  )
}

// In progress = anything not queued, verified, or rejected.
const inProgress = (issue) => !issue.dismissed && issue.status !== 'queued' && issue.status !== 'done'

/** Card tags: one small dot per target color used (unit, trait, item, augment, system, bug fix). Hover lists the tags. */
function TagDots({ tags }) {
  const names = tags.map((t) => tagInfo(t)?.label ?? t).join(', ')
  const targets = [...new Set(tags.map((t) => tagInfo(t)?.target).filter(Boolean))]
  return (
    <div className="mt-3 flex items-center gap-1.5" title={names}>
      {targets.map((k) => (
        <span key={k} aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: TARGETS[k].color }} />
      ))}
      {tags.filter(tag => !tagInfo(tag)).map(tag => <span key={tag} className="rounded bg-surface px-2 py-0.5 text-xs text-muted">{tag}</span>)}
      <span className="sr-only">Tags: {names}</span>
    </div>
  )
}

/** Display the actual backend stage or persisted human decision. */
function CardStatus({ issue }) {
  return <StatusBadge status={issue.status} label={issue.statusLabel} />
}

/** One Work Board card. Shows the sub-stage only where a column spans more than one. */
function BoardCard({ issue, showStage }) {
  const failed = issue.status === 'error' && !issue.dismissed
  const working = inProgress(issue)
  const tags = sortTags(issue.tags ?? [])
  return (
    <li>
      <Link
        to={`/issues/${issue.id}`}
        className={`group block rounded-lg border bg-card p-3.5 shadow-sm transition-[transform,background-color,border-color] hover:-translate-y-px hover:bg-card-hover ${failed ? 'border-warning/60' : working ? 'border-accent/60' : 'border-border hover:border-border-strong'}`}
      >
        {showStage && <div className="mb-1.5 text-xs text-muted">{STAGE_LABEL[issue.stage]}</div>}
        <p className="text-sm font-semibold leading-snug">{issue.title}</p>
        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted">{issue.summary}</p>
        {tags.length > 0 && <TagDots tags={tags} />}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
          <CardStatus issue={issue} />
          <span className="flex shrink-0 items-center gap-1 font-mono text-xs text-muted" title="Saved feedback items"><UpvoteIcon />{num(issue.mentions)}<span className="sr-only"> feedback items</span></span>
        </div>
      </Link>
    </li>
  )
}

export default function Board() {
  const { state } = usePipeline()
  const [f, setF] = useState(NO_FILTERS)
  // Date filters compare against when the page opened (read once, not on every render).
  const [now] = useState(() => Date.now())
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }))
  const live = state.issues.filter((i) => !i.mergedInto)
  const cutoff = now - DATES[f.date][1] * 3600 * 1000
  // All filters combine (AND).
  const shown = live
    .filter((i) => f.platform === 'all' || i.sources[f.platform] > 0)
    .filter((i) => f.date === 'all' || new Date(i.firstSeen).getTime() >= cutoff)
    .filter((i) => f.tag === 'all' || (i.tags ?? []).some((t) => tagInfo(t)?.target === f.tag))

  // Tags filter = the color categories shown as dots on cards (Unit, Trait, Item, Augment, System, Bug fix).
  const tagOptions = [['all', 'All'], ...Object.entries(TARGETS).map(([k, t]) => [k, t.label])]
  const active = Object.values(f).filter((v) => v !== 'all').length

  if (!state.issues.length) {
    return (
      <>
        <h1 className="sr-only">Board</h1>
        <StateView kind="empty" title="No discovered issues yet">Saved Discovery groups will appear here automatically.</StateView>
      </>
    )
  }

  return (
    <>
      <PageTitle title="Work Board">Live backend state. Feedback is synthetic player input, not measured gameplay evidence.</PageTitle>

      <Section className="border-t-0 pt-0">
        <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3" role="group" aria-label="Filter the board">
          <Select label="Platform" value={f.platform} onChange={set('platform')} options={[['all', 'All'], ...Object.entries(SOURCES).map(([k, v]) => [k, v.label])]} />
          <Select label="Date" value={f.date} onChange={set('date')} options={Object.entries(DATES).map(([k, v]) => [k, v[0]])} />
          <Select label="Tags" value={f.tag} onChange={set('tag')} options={tagOptions} dot={TARGETS[f.tag]?.color} />
          {active > 0 && <button type="button" onClick={() => setF(NO_FILTERS)} className="text-sm text-muted hover:text-text">Clear</button>}
        </div>
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BOARD.map((col) => {
            const items = shown
              .filter((i) => (col.id === 'closed' ? col.stages.includes(i.stage) || i.dismissed : col.stages.includes(i.stage) && !i.dismissed))
              .sort((a, b) => b.mentions - a.mentions)
            return (
              <section key={col.id} aria-labelledby={`col-${col.id}`} className="flex flex-col rounded-xl bg-lane p-2.5">
                <h3 id={`col-${col.id}`} className="flex items-baseline justify-between px-1.5 pb-3 pt-1 font-display text-base font-bold">
                  {col.label}
                  <span className="font-sans text-xs font-normal text-muted">{items.length}</span>
                </h3>
                <ul className="space-y-2.5">
                  {items.map((i) => (
                    <BoardCard key={i.id} issue={i} showStage={col.stages.length > 1 || i.dismissed} />
                  ))}
                </ul>
                {!items.length && <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted">{EMPTY[col.id]}{active ? ' matching these filters' : ''}.</p>}
              </section>
            )
          })}
        </div>
      </Section>
    </>
  )
}
