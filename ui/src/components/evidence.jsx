import { useEffect, useMemo, useRef, useState } from 'react'
import { SOURCES } from '../data/constants'
import { makeClusterPosts } from '../data/generators'
import { usePipeline } from '../store/pipeline'
import { UpvoteIcon } from './ui'
import { num, timeAgo } from './format'

export function Sparkline({ data, width = 72, height = 20 }) {
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const d = data
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (data.length - 1)) * width).toFixed(1)},${(height - 1 - ((v - min) / (max - min || 1)) * (height - 2)).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={width} height={height} role="img" aria-label={`14-day trend: ${data[0]} to ${data.at(-1)} mentions per day`}>
      <path d={d} fill="none" className={data.at(-1) >= data[0] ? 'stroke-accent-text' : 'stroke-muted'} strokeWidth="1.5" />
    </svg>
  )
}

const PAGE = 15

/** One post in the browser: score, then the title linking to the original (empty href until the backend is connected). */
function PostRow({ post }) {
  return (
    <li className="grid grid-cols-[4.5rem_1fr] gap-3 py-3">
      <span className="flex items-start justify-end gap-1 pt-0.5 font-mono text-xs text-muted" title="Score (upvotes or likes)"><UpvoteIcon className="mt-px" />{num(post.engagement.likes)}</span>
      <div className="min-w-0">
        <a href="" target="_blank" rel="noreferrer" onClick={(e) => e.preventDefault()} className="leading-snug hover:underline">
          {post.text}
          <span aria-hidden className="ml-1 text-muted">↗</span>
          <span className="sr-only"> (opens original post in a new tab)</span>
        </a>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
          {post.pinned && <span className="text-text">Representative</span>}
          <span>{post.author}</span>
          <time dateTime={post.ts}>{timeAgo(post.ts)}</time>
          <span>{num(post.engagement.replies)} replies</span>
        </div>
      </div>
    </li>
  )
}

/**
 * Sources box (spec 6.2.1): one pill per platform with its post count. Clicking a pill
 * replaces the pills, in the same box, with that platform's posts: back button, keyword search,
 * and an infinite-scroll list sorted by score.
 */
export function SourceBrowser({ issue }) {
  const { state, dispatch } = usePipeline()
  const all = useMemo(() => makeClusterPosts(issue), [issue])
  const [open, setOpen] = useState(null) // platform id, or null = pill view
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const boxRef = useRef(null)
  const endRef = useRef(null)

  const query = q.trim().toLowerCase()
  const list = useMemo(() => {
    if (!open) return []
    return all
      .filter((p) => p.source === open)
      .filter((p) => !query || p.text.toLowerCase().includes(query) || p.author.toLowerCase().includes(query))
      .sort((a, b) => b.engagement.likes - a.engagement.likes)
  }, [all, open, query])
  const more = shown < list.length

  useEffect(() => {
    const end = endRef.current
    if (!end || !more) return
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && setShown((n) => n + PAGE), { root: boxRef.current, rootMargin: '200px' })
    io.observe(end)
    return () => io.disconnect()
  }, [more, list])

  const openSource = (k) => {
    setOpen(k)
    setQ('')
    setShown(PAGE)
  }

  return (
    <div className="rounded-lg bg-surface p-4">
      {!open ? (
        <div className="flex flex-wrap gap-2">
          {Object.keys(SOURCES).filter((k) => issue.sources[k]).map((k) => {
            const err = state.sourceStatus[k]?.state === 'error'
            return (
              <span key={k} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openSource(k)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors hover:border-text ${err ? 'border-warning/70' : 'border-border-strong'}`}
                >
                  {SOURCES[k].label} <span className="font-mono text-muted">{num(issue.sources[k])}</span>
                  {err && <span className="ml-1.5 text-warning">! <span className="sr-only">posts failed to load</span></span>}
                </button>
                {err && (
                  <button type="button" onClick={() => dispatch({ type: 'SOURCE_RETRY', source: k })} className="text-xs text-muted underline underline-offset-4 hover:text-text">
                    Retry
                  </button>
                )}
              </span>
            )
          })}
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setOpen(null)} className="shrink-0 text-sm font-semibold text-muted hover:text-text">← Back</button>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Search {SOURCES[open].label} posts</span>
              <input
                type="search"
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setShown(PAGE)
                  if (boxRef.current) boxRef.current.scrollTop = 0
                }}
                placeholder={`Search ${num(issue.sources[open])} ${SOURCES[open].label} posts`}
                className="h-9 w-full rounded-full border border-border-strong bg-transparent px-4 text-sm placeholder:text-muted/70"
              />
            </label>
          </div>
          <div ref={boxRef} className="mt-3 max-h-[32rem] overflow-y-auto pr-2" aria-live="polite">
            {list.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">No {SOURCES[open].label} posts match “{q}”.</p>
            ) : (
              <ol className="divide-y divide-border">
                {list.slice(0, shown).map((p) => <PostRow key={p.id} post={p} />)}
              </ol>
            )}
            <div ref={endRef} className="py-3 text-center text-xs text-muted">
              {more ? 'Loading more…' : list.length > 0 ? `That’s all ${num(list.length)} posts.` : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Before → after value, delta, and sample-size / confidence. */
export function StatCard({ label, before, after, unit = '', ci, sample, target }) {
  const delta = after != null ? Math.round((after - before) * 10) / 10 : null
  const inTarget = target && after != null && after >= target[0] && after <= target[1]
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-3xl font-bold tracking-tight tabular-nums">
        {after != null ? (
          <>
            <span className="text-muted">{before}</span>
            <span aria-label="to" className="mx-2 text-xl text-muted">→</span>
            {after}
            <span className="text-xl">{unit}</span>
          </>
        ) : (
          <>
            {before}
            <span className="text-xl">{unit}</span>
          </>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
        {delta != null && <span className="text-text">{delta > 0 ? '+' : ''}{delta}{unit}</span>}
        {ci != null && <span>±{ci}{unit} (95% CI)</span>}
        {sample != null && <span>n = {num(sample)} per build</span>}
        {target && <span className={inTarget ? 'text-success' : ''}>{inTarget ? '✓ ' : ''}target {target[0]}–{target[1]}{unit}</span>}
      </div>
    </div>
  )
}

const VERDICTS = {
  supported: { title: 'Complaint supported by data', sub: 'The change worked.', icon: '✓', tone: 'text-success border-success' },
  partial: { title: 'Complaint supported by data', sub: 'The change helped, but not enough.', icon: '◐', tone: 'text-warning border-warning' },
  failed: { title: 'Complaint supported by data', sub: 'The change did not help.', icon: '✕', tone: 'text-accent-text border-accent' },
  not_supported: { title: 'Not supported', sub: 'Live stats don’t back the complaint.', icon: '?', tone: 'text-warning border-warning' },
  inconclusive: { title: 'Inconclusive', sub: 'The difference is within noise.', icon: '…', tone: 'text-info border-info' },
}

export function VerdictBanner({ playtest }) {
  const v = VERDICTS[playtest.overall]
  const moved = { reached: 'Yes, into the target range.', improved: 'Partly. Closer, but not in range.', worse: 'No. It moved away.', inconclusive: 'Can’t tell. Within noise.' }[playtest.movement]
  return (
    <section aria-label="Verdict" className={`border-l-2 pl-5 ${v.tone.split(' ')[1]}`}>
      <p className="font-display text-2xl font-bold tracking-tight">
        <span aria-hidden className={`mr-2 font-mono ${v.tone.split(' ')[0]}`}>{v.icon}</span>
        {v.title}
        <span className="font-normal text-muted"> · {v.sub}</span>
      </p>
      <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-muted">Was the original complaint backed by stats?</dt>
          <dd className="mt-0.5">{playtest.complaintSupported ? 'Yes. ' : 'No. '}<span className="text-muted">{playtest.reasons[0]}</span></dd>
        </div>
        <div>
          <dt className="text-muted">Did the change move the metric toward the target?</dt>
          <dd className="mt-0.5">{moved} <span className="text-muted">{playtest.reasons[1]}</span></dd>
        </div>
      </dl>
    </section>
  )
}
