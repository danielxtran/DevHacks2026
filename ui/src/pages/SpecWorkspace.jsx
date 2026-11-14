import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { usePipeline } from '../store/pipeline'
import { latestSpec } from '../store/reducer'
import { specToText } from '../data/generators'
import { AgentActivityPanel, ApprovalGate } from '../components/pipelineParts'
import { Button, ErrorPanel, Skeleton, StateView, VersionPicker } from '../components/ui'
import DiffView from '../components/DiffView'
import { stamp, timeAgo } from '../components/format'

const LIST_FIELDS = [
  ['systems', 'Affected systems'],
  ['plan', 'Architecture & build plan'],
  ['risks', 'Risks'],
  ['metrics', 'Success metrics'],
]

const Author = ({ v }) => (
  <span className={v.author === 'agent' ? 'text-info' : 'text-text'}>
    {v.authorName} <span className="text-muted">({v.author})</span>
  </span>
)

function Rich({ text }) {
  return text.split(/(`[^`]+`)/g).map((p, i) =>
    p.startsWith('`') ? <code key={i} className="font-mono text-[0.85em] text-text">{p.slice(1, -1)}</code> : <span key={i}>{p}</span>,
  )
}

function SystemsDiagram({ spec }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" role="img" aria-label={`${spec.param.key} affects ${spec.systems.join(', ')}`}>
      <span className="rounded-lg border border-accent/60 px-3 py-2 font-mono text-xs">
        {spec.param.key}
        <span className="ml-2 text-muted">{spec.param.before}→{spec.param.after}{spec.param.unit}</span>
      </span>
      <span aria-hidden className="text-muted">→</span>
      {spec.systems.map((s) => (
        <span key={s} className="rounded-lg border border-border px-3 py-2 text-xs">{s}</span>
      ))}
      {!spec.systems.length && <span className="text-xs text-muted">No systems in scope</span>}
    </div>
  )
}

function SpecHeading({ children }) {
  return <h3 className="mb-1.5 mt-7 text-sm text-muted first:mt-0">{children}</h3>
}

function SpecView({ spec }) {
  return (
    <div className="leading-relaxed">
      <SpecHeading>Problem</SpecHeading>
      <p>{spec.problem}</p>
      <SpecHeading>Proposed change</SpecHeading>
      <p>{spec.change}</p>
      {LIST_FIELDS.map(([k, label]) => (
        <div key={k}>
          <SpecHeading>{label}</SpecHeading>
          <ul className="list-disc space-y-1 pl-5 marker:text-muted">
            {spec[k].map((x, i) => <li key={i}><Rich text={x} /></li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}

function FieldLabel({ children }) {
  return <span className="text-sm text-muted">{children}</span>
}

function SpecEditor({ spec, onSave, onCancel }) {
  const [d, setD] = useState(() => ({
    problem: spec.problem,
    change: spec.change,
    after: String(spec.param.after),
    ...Object.fromEntries(LIST_FIELDS.map(([k]) => [k, spec[k].join('\n')])),
  }))
  const [note, setNote] = useState('')
  const set = (k) => (e) => setD((p) => ({ ...p, [k]: e.target.value }))
  const after = Number(d.after)
  const valid = d.after.trim() !== '' && Number.isFinite(after)
  const field = 'mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm leading-relaxed'

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        const lists = Object.fromEntries(LIST_FIELDS.map(([k]) => [k, d[k].split('\n').map((s) => s.trim()).filter(Boolean)]))
        const param = { ...spec.param, after }
        onSave(
          {
            ...spec,
            problem: d.problem,
            change: d.change,
            param,
            ...lists,
            summary: [`${spec.summary[0].split(':')[0]}: ${param.before}${param.unit} → ${param.after}${param.unit}`, `Touches ${lists.systems.length} systems: ${lists.systems.join(', ')}`, spec.summary[2]],
          },
          note,
        )
      }}
    >
      <label className="block"><FieldLabel>Problem</FieldLabel><textarea rows={3} value={d.problem} onChange={set('problem')} className={field} /></label>
      <label className="block"><FieldLabel>Proposed change</FieldLabel><textarea rows={3} value={d.change} onChange={set('change')} className={field} /></label>
      <label className="block max-w-xs">
        <FieldLabel>New value for {spec.param.key} (was {spec.param.before}{spec.param.unit})</FieldLabel>
        <input value={d.after} onChange={set('after')} inputMode="decimal" aria-invalid={!valid} className={`${field} font-mono ${valid ? '' : 'border-warning'}`} />
        {!valid && <span className="text-xs text-warning">Enter a number.</span>}
      </label>
      {LIST_FIELDS.map(([k, label]) => (
        <label key={k} className="block">
          <FieldLabel>{label} (one per line)</FieldLabel>
          <textarea rows={Math.max(2, d[k].split('\n').length)} value={d[k]} onChange={set(k)} className={field} />
        </label>
      ))}
      <label className="block"><FieldLabel>What did you change?</FieldLabel><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shown in version history" className={field} /></label>
      <div className="flex items-center gap-5">
        <Button type="submit" variant="primary" disabled={!valid}>Save as new version</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

function VersionHistory({ issue }) {
  const vs = issue.specVersions
  const [a, setA] = useState(Math.max(1, vs.length - 1))
  const [b, setB] = useState(vs.length)
  const pick = (val, set, label) => (
    <select aria-label={label} value={val} onChange={(e) => set(Number(e.target.value))} className="select-pill">
      {vs.map((v) => <option key={v.v} value={v.v}>v{v.v}</option>)}
    </select>
  )
  return (
    <div className="space-y-6">
      <ol className="space-y-2 text-sm">
        {[...vs].reverse().map((v) => (
          <li key={v.v} className="grid grid-cols-[2.5rem_1fr_auto] gap-3">
            <span className="font-semibold">v{v.v}</span>
            <span className="min-w-0">
              <Author v={v} /> <span className="text-muted">· {v.note}</span>
              {issue.approvals.spec?.v === v.v && <span className="text-success"> · ✓ approved</span>}
            </span>
            <time className="text-xs text-muted" dateTime={v.ts}>{stamp(v.ts)}</time>
          </li>
        ))}
      </ol>
      {vs.length > 1 ? (
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm text-muted">
            Compare {pick(a, setA, 'From version')} → {pick(b, setB, 'To version')}
          </div>
          <DiffView oldValue={mdOf(vs[a - 1])} newValue={mdOf(vs[b - 1])} leftTitle={`v${a}`} rightTitle={`v${b}`} />
        </div>
      ) : (
        <p className="text-sm text-muted">Edit the spec or ask the agent for a rewrite to compare versions here.</p>
      )}
    </div>
  )
}

const mdOf = (version) => version.markdown ?? specToText(version.spec)

/** The .md spec (spec 6.2.2): the main focus. Fully editable, mono; saving makes a new version. */
function MarkdownEditor({ issue, version, latestV, readOnly, rewriting, onCommit }) {
  const { dispatch } = usePipeline()
  const original = mdOf(version)
  const [draft, setDraft] = useState(original)
  const dirty = draft !== original
  const old = version.v !== latestV
  return (
    <div>
      <div className="relative">
        <label htmlFor="spec-md" className="sr-only">Spec markdown, version {version.v}</label>
        <textarea
          id="spec-md"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          readOnly={readOnly}
          spellCheck={false}
          className={`min-h-[32rem] w-full resize-y rounded-lg border border-border bg-surface-2 p-4 font-mono text-[13px] leading-relaxed ${readOnly ? 'text-muted' : ''}`}
        />
        {rewriting && (
          <span role="status" className="absolute right-3 top-3 flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs text-muted shadow">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-info" />
            Agent is rewriting…
          </span>
        )}
      </div>
      {dirty && !readOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Button variant="primary" size="sm" onClick={() => { dispatch({ type: 'SPEC_EDIT', id: issue.id, markdown: draft, fromV: version.v, note: 'Edited the .md' }); onCommit() }}>
            Save as v{version.v + 1}
          </Button>
          <Button variant="ghost" onClick={() => setDraft(original)}>Discard</Button>
          {old && <span className="text-xs text-muted"><span aria-hidden className="text-warning">! </span>Saving from v{version.v} discards v{version.v + 1}–v{latestV}.</span>}
        </div>
      )}
    </div>
  )
}

const SUGGESTIONS = ['Make this a smaller nerf', 'Don’t touch tooltips', 'Split into two phases']

function SpecChat({ issue, disabled, fromV, latestV, onCommit }) {
  const { dispatch } = usePipeline()
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const listRef = useRef(null)
  const boxRef = useRef(null)
  // Prompt box grows with its content.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [issue.chat.length, issue.run?.idx])
  const send = (t) => {
    if (disabled) return
    if (!t.trim()) return setError('Type an instruction for the agent first.')
    dispatch({ type: 'SPEC_CHAT', id: issue.id, text: t.trim().replace('’', "'"), fromV: fromV < latestV ? fromV : undefined })
    setText('')
    setError(null)
    onCommit()
  }
  return (
    <div className="flex flex-col lg:border-l lg:border-border lg:pl-8">
      <h2 className="text-sm text-muted">Ask the Spec Writer to change it</h2>
      <ol ref={listRef} className="mt-4 max-h-[26rem] min-h-40 flex-1 space-y-4 overflow-y-auto" aria-live="polite">
        {issue.chat.map((m, i) => (
          <li key={i} className={`text-sm leading-relaxed ${m.role === 'human' ? 'pl-6 text-right' : 'pr-6'}`}>
            <div className="text-xs text-muted">{m.role === 'human' ? 'You' : 'Spec Writer'} · {timeAgo(m.ts)}</div>
            <p className="mt-0.5">{m.text}</p>
          </li>
        ))}
        {issue.run?.agent === 'spec' && <li className="animate-pulse-soft text-sm text-muted">Spec Writer is writing…</li>}
      </ol>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" disabled={disabled} onClick={() => send(s)} className="text-xs text-muted underline decoration-border underline-offset-4 hover:text-text disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>
      {fromV < latestV && !disabled && (
        <p className="mt-3 text-xs text-muted"><span aria-hidden className="text-warning">! </span>Prompting from v{fromV} discards v{fromV + 1}–v{latestV}. The rewrite becomes v{fromV + 1}.</p>
      )}
      <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(text) }} noValidate>
        <div className="min-w-0 flex-1">
          <label htmlFor="chat" className="sr-only">Message to the Spec Writer</label>
          <textarea
            id="chat"
            ref={boxRef}
            rows={1}
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={error ? 'chat-err' : undefined}
            placeholder={disabled ? 'Closed for this stage' : 'e.g. Don’t touch netcode'}
            className={`block max-h-60 min-h-11 w-full resize-none rounded-2xl border bg-transparent px-4 py-2.5 text-sm leading-relaxed placeholder:text-muted/70 disabled:opacity-60 ${error ? 'border-warning' : 'border-border'}`}
          />
        </div>
        <Button type="submit" disabled={disabled}>Send</Button>
      </form>
      {error && <p id="chat-err" className="mt-1 pl-4 text-xs text-warning">{error}</p>}
    </div>
  )
}

export default function SpecWorkspace() {
  const { issue } = useOutletContext()
  const { dispatch } = usePipeline()
  const navigate = useNavigate()
  const [view, setView] = useState('md')
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState(null) // null = always show the latest version
  const latest = issue.specVersions.at(-1)
  const shown = (picked && issue.specVersions[picked - 1]) || latest
  const viewingOld = shown && latest && shown.v !== latest.v
  const spec = shown?.spec ?? latestSpec(issue)
  const running = issue.run?.agent === 'spec'
  const inSpec = issue.stage === 'spec'
  const locked = !inSpec || running

  if (!spec && !running && !issue.error) {
    return (
      <StateView
        kind="empty"
        title="No spec yet"
        action={
          issue.stage === 'feedback' &&
          ((issue.devs ?? []).length ? (
            <Button variant="primary" onClick={() => dispatch({ type: 'SEND_TO_SPEC', id: issue.id })}>Push to development →</Button>
          ) : (
            <Button to={`/issues/${issue.id}`}>Assign a dev first →</Button>
          ))
        }
      >
        The Spec Writer drafts one once the issue is pushed to development. At least one developer has to be assigned first.
      </StateView>
    )
  }

  const tab = (k, l) => (
    <button key={k} role="tab" type="button" aria-selected={view === k && !editing} onClick={() => { setView(k); setEditing(false) }} className={`sel px-3 py-1.5 text-sm ${view === k && !editing ? 'font-semibold' : 'text-muted hover:text-text'}`}>
      {l}
    </button>
  )

  return (
    <div className="space-y-8">
      {issue.error && inSpec && <ErrorPanel error={issue.error} onRetry={() => dispatch({ type: 'RETRY_RUN', id: issue.id })} />}
      <AgentActivityPanel issueId={issue.id} />

      {latest && (
        <VersionPicker
          label="Spec version"
          value={shown.v}
          onChange={(v) => { setPicked(v === latest.v ? null : v); setEditing(false) }}
          options={[...issue.specVersions].reverse().map((v) => [
            v.v,
            `v${v.v} · ${v.authorName}${v.v === latest.v ? ' · latest' : ''}${issue.approvals.spec?.v === v.v ? ' · approved' : ''}`,
          ])}
          note={viewingOld ? <>Viewing an older version. <button type="button" className="underline underline-offset-4 hover:text-text" onClick={() => setPicked(null)}>Back to v{latest.v}</button></> : <>by <Author v={shown} /> · {shown.note}</>}
        />
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2">
            <div role="tablist" aria-label="Spec view" className="flex gap-1 sm:ml-auto">
              {tab('md', 'spec.md')}
              {tab('summary', 'Summary')}
              {tab('full', 'Full spec')}
              {tab('history', `Compare (${issue.specVersions.length})`)}
              {!locked && spec && !viewingOld && (
                <button type="button" aria-pressed={editing} onClick={() => setEditing(true)} className={`sel px-3 py-1.5 text-sm ${editing ? 'font-semibold' : 'text-muted hover:text-text'}`}>Edit</button>
              )}
            </div>
          </div>
          {!spec ? (
            <div className="space-y-3" aria-label="Spec loading">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-3/5" />
            </div>
          ) : editing ? (
            <SpecEditor key={latest.v} spec={spec} onCancel={() => setEditing(false)} onSave={(next, note) => { dispatch({ type: 'SPEC_EDIT', id: issue.id, spec: next, note }); setEditing(false) }} />
          ) : view === 'md' ? (
            <MarkdownEditor key={`${shown.v}-${latest.v}`} issue={issue} version={shown} latestV={latest.v} readOnly={locked} rewriting={running} onCommit={() => setPicked(null)} />
          ) : view === 'summary' ? (
            <div className="space-y-8">
              <ul className="space-y-2 text-lg leading-relaxed">
                {spec.summary.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
              <SystemsDiagram spec={spec} />
            </div>
          ) : view === 'full' ? (
            <SpecView spec={spec} />
          ) : (
            <VersionHistory key={issue.specVersions.length} issue={issue} />
          )}
        </div>
        <SpecChat issue={issue} disabled={locked} fromV={shown?.v ?? 0} latestV={latest?.v ?? 0} onCommit={() => setPicked(null)} />
      </div>

      {spec && (
        <ApprovalGate
          approveLabel={`Approve v${latest.v} & send to playtest`}
          approval={issue.approvals.spec}
          note={viewingOld && <p className="text-sm text-muted">You’re viewing v{shown.v}. Approval applies to the latest version, v{latest.v}.</p>}
          disabled={running || !inSpec || issue.status === 'error'}
          disabledReason={running ? 'Wait for the Spec Writer to finish.' : issue.status === 'error' ? 'Resolve the agent error first.' : null}
          onApprove={(comment) => { dispatch({ type: 'SPEC_APPROVE', id: issue.id, comment }); navigate(`/issues/${issue.id}/playtest`) }}
          onRequestChanges={(comment) => dispatch({ type: 'SPEC_CHAT', id: issue.id, text: comment })}
          onReject={(comment) => dispatch({ type: 'SPEC_REJECT', id: issue.id, comment })}
          rejectLabel="Reject spec"
        />
      )}
    </div>
  )
}
