import { useState } from 'react'
import DiffView from './DiffView'

function Checks({ build }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {build.checks.map((c) => (
        <li key={c.name} className="grid grid-cols-[1.25rem_1fr] gap-1">
          <span aria-hidden className={c.status === 'pass' ? 'text-success' : 'text-accent-text'}>{c.status === 'pass' ? '✓' : '✕'}</span>
          <span>
            {c.name} <span className="sr-only">{c.status}</span>
            <span className="text-muted"> · {c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function Files({ build }) {
  const [sel, setSel] = useState(0)
  const f = build.files[Math.min(sel, build.files.length - 1)]
  return (
    <div>
      <div role="tablist" aria-label="Files" className="mb-3 flex flex-wrap gap-4">
        {build.files.map((file, i) => (
          <button key={file.path} role="tab" aria-selected={sel === i} type="button" onClick={() => setSel(i)} className={`font-mono text-xs ${sel === i ? 'text-text underline underline-offset-4' : 'text-muted hover:text-text'}`}>
            {file.path}{!file.oldValue && ' (new)'}
          </button>
        ))}
      </div>
      <DiffView oldValue={f.oldValue} newValue={f.newValue} leftTitle="main" rightTitle={build.branch} />
    </div>
  )
}

/**
 * The background build, shown as evidence on the Playtest page.
 * Keeps "agent says done" apart from what the checks found.
 */
export default function BuildSummary({ build, builds = [] }) {
  if (!build) return null
  const earlier = builds.filter((b) => b.specV === build.specV && b.attempt < build.attempt)
  return (
    <details className="border-t border-border pt-5">
      <summary className="cursor-pointer font-display text-lg font-bold">
        Code change
        <span className="ml-2 font-sans text-sm font-normal text-muted">
          {build.checksPassed ? <><span className="text-success">✓</span> {build.checks.length} checks passed</> : <><span className="text-accent-text">✕</span> checks failed</>}
          {' · '}attempt {build.attempt} · {build.files.length} file{build.files.length === 1 ? '' : 's'}
        </span>
      </summary>
      <div className="mt-6 space-y-8">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <h3 className="text-sm text-muted">Builder says</h3>
            <p className="mt-2 leading-relaxed">“{build.agentClaim}”</p>
            <p className="mt-3 text-xs text-muted">A claim, not evidence. The playtest only starts once every check passes.</p>
          </div>
          <div>
            <h3 className="text-sm text-muted">Checks</h3>
            <div className="mt-2"><Checks build={build} /></div>
          </div>
        </div>
        {earlier.length > 0 && (
          <p className="text-sm text-muted">
            {earlier.map((b) => (
              <span key={b.attempt}>Attempt {b.attempt} said “done” but {b.checksPassed ? 'passed' : `failed ${b.checks.filter((c) => c.status !== 'pass').map((c) => c.name).join(', ')}`}, so the Builder tried again. </span>
            ))}
          </p>
        )}
        <Files key={build.attempt} build={build} />
      </div>
    </details>
  )
}
