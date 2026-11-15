import { useState } from 'react'
import { DEVS, DIRECTIONS, SOURCES, STATUSES, TAGS, TARGETS, devLabel, resolveTag, sortTags, tagInfo } from '../data/constants'
import { usePipeline } from '../store/pipeline'
import { num } from './format'

/** "r/ 812 · X 640". A failing scraper shows "!" plus a text label. */
export function Sources({ sources }) {
  const { state } = usePipeline()
  return (
    <span className="inline-flex gap-3 font-mono text-xs text-muted">
      {Object.keys(SOURCES)
        .filter((k) => sources[k])
        .map((k) => {
          const err = state.sourceStatus[k]?.state === 'error'
          return (
            <span key={k} title={`${SOURCES[k].label}: ${num(sources[k])} feedback items${err ? ' (collection failed)' : ''}`} className={err ? 'text-warning' : ''}>
              <span className="text-text">{SOURCES[k].glyph}</span> {num(sources[k])}
              {err && <span> ! <span className="sr-only">scraper failing</span></span>}
            </span>
          )
        })}
    </span>
  )
}

/** One tag pill: fix-type (tinted, direction icon) or specific (neutral, colored dot). Optional × to remove. */
export function TagPill({ id, onRemove, size = 'md' }) {
  const t = tagInfo(id)
  if (!t) return <span className="rounded-full border border-border px-3 py-1 text-xs text-muted">{id}</span>
  const color = TARGETS[t.target].color
  const fixType = t.family === 'fix'
  const pad = size === 'sm' ? 'py-0.5 pl-2.5 text-[11px]' : 'py-1 pl-3 text-xs'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${pad} ${onRemove ? 'pr-1.5' : size === 'sm' ? 'pr-2.5' : 'pr-3'} ${fixType ? 'tag-fix' : 'tag-specific'}`} style={{ '--c': color }}>
      {fixType ? (
        <span aria-hidden className="font-mono leading-none">{DIRECTIONS[t.dir]}</span>
      ) : (
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      )}
      <span className="sr-only">{fixType ? 'Fix type' : `${TARGETS[t.target].label} tag`}: </span>
      {t.label}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${t.label} tag`}
          onClick={onRemove}
          className="flex h-4 w-4 items-center justify-center rounded-full opacity-70 hover:bg-border-strong hover:opacity-100"
        >
          ×
        </button>
      )}
    </span>
  )
}

// Tag editor kinds: one fix-type option, then one per specific target.
const EDIT_KINDS = [['fix', 'Fix type'], ...Object.entries(TARGETS).filter(([k]) => k !== 'bug').map(([k, v]) => [k, v.label])]

/**
 * Tags on the issue page: pills with ×, then a kind selector, a text input (suggests catalog names),
 * and + Add tag. Fix types must come from the list; specific names not in the catalog become custom tags.
 */
export function SubjectTags({ issue, editable = true }) {
  const { dispatch } = usePipeline()
  const tags = sortTags(issue.tags ?? [])
  const [kind, setKind] = useState('fix')
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const family = kind === 'fix' ? 'fix' : 'specific'
  const suggestions = Object.entries(TAGS).filter(([id, t]) => t.family === family && (family === 'fix' || t.target === kind) && !tags.includes(id))

  const add = (e) => {
    e.preventDefault()
    if (!text.trim()) return setError('Type a tag name first.')
    const id = resolveTag(family, kind, text)
    if (!id) return setError('Pick a fix type from the list (e.g. Unit nerf).')
    if (tags.includes(id)) return setError('That tag is already on this issue.')
    dispatch({ type: 'SUBJECT_ADD', id: issue.id, tag: id })
    setText('')
    setError(null)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((t) => (
          <TagPill key={t} id={t} onRemove={editable ? () => dispatch({ type: 'SUBJECT_REMOVE', id: issue.id, tag: t }) : undefined} />
        ))}
        {!tags.length && <span className="text-xs text-muted">No tags yet.</span>}
      </div>
      {editable && (
        <form onSubmit={add} className="mt-3 flex flex-wrap items-start gap-2" noValidate>
          <label className="sr-only" htmlFor={`tag-kind-${issue.id}`}>Tag kind</label>
          <select id={`tag-kind-${issue.id}`} value={kind} onChange={(e) => { setKind(e.target.value); setError(null) }} className="select-pill">
            {EDIT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <div>
            <label className="sr-only" htmlFor={`tag-text-${issue.id}`}>Tag name</label>
            <input
              id={`tag-text-${issue.id}`}
              list={`tag-list-${issue.id}`}
              value={text}
              onChange={(e) => { setText(e.target.value); setError(null) }}
              placeholder={kind === 'fix' ? 'e.g. Unit nerf' : `e.g. ${suggestions[0]?.[1].label ?? 'name'}`}
              aria-invalid={!!error}
              aria-describedby={error ? `tag-err-${issue.id}` : undefined}
              className={`h-9 w-52 rounded-full border bg-transparent px-4 text-sm placeholder:text-muted/70 ${error ? 'border-warning' : 'border-border-strong'}`}
            />
            <datalist id={`tag-list-${issue.id}`}>
              {suggestions.map(([id, t]) => <option key={id} value={t.label} />)}
            </datalist>
            {error && <p id={`tag-err-${issue.id}`} className="mt-1 pl-4 text-xs text-warning">{error}</p>}
          </div>
          <button type="submit" className="sel h-9 px-3 text-sm font-semibold text-muted hover:text-text">+ Add tag</button>
        </form>
      )}
    </div>
  )
}

/** "Assign to" checklist (spec 6.2.1): one checkbox per developer. Drives the Push to development gate. */
export function AssigneeChecklist({ issue }) {
  const { dispatch } = usePipeline()
  const devs = issue.devs ?? []
  return (
    <fieldset>
      <legend className="mb-2 text-sm text-muted">Assign to</legend>
      <div className="space-y-1.5">
        {Object.keys(DEVS).map((d) => {
          const on = devs.includes(d)
          return (
            <label key={d} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={on}
                onChange={() => dispatch({ type: on ? 'DEV_UNASSIGN' : 'DEV_ASSIGN', id: issue.id, dev: d })}
                className="h-4 w-4 accent-accent"
              />
              {devLabel(d)}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

const TONE = { muted: 'text-muted', info: 'text-info', accent: 'text-accent-text', success: 'text-success', warning: 'text-warning' }

// Icon + text so status never depends on color alone.
export function StatusBadge({ status, label }) {
  const s = STATUSES[status] || STATUSES.queued
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${TONE[s.tone]}`}>
      <span aria-hidden className={`font-mono ${status === 'running' ? 'animate-pulse-soft' : ''}`}>{s.icon}</span>
      {label ?? s.label}
    </span>
  )
}
