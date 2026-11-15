import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { usePipeline } from '../store/pipeline'
import { Button, Section, StateView } from '../components/ui'
import { stamp } from '../components/format'
import SimulationResults from '../components/SimulationResults'
import DiffView from '../components/DiffView'

const ACTOR = 'You'
const field = 'mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm'
const phases = {
  spec_queued: 'Specification queued', spec_review: 'Ready for spec review', spec_failed: 'Specification failed',
  simulation_queued: 'Simulation queued', simulation_review: 'Ready for simulation review',
  failed: 'Simulation failed', accepted: 'Accepted', experiment_rejected: 'Experiment rejected', spec_rejected: 'Spec rejected',
}
const simulationStates = {
  queued: 'Simulation queued', running: 'Running Hexlab comparison…', succeeded: 'Simulation complete',
  failed: 'Simulation failed', interrupted: 'Simulation interrupted', retired: 'Historical simulation',
}
const stampId = value => value ? new Date(value).toLocaleString() : '—'

function CommandStatus({ busy, error, message }) {
  if (error) return <p className="mt-4 text-sm text-warning" role="alert">{error}</p>
  if (busy) return <p className="mt-4 text-sm text-muted" role="status">Saving command…</p>
  if (message) return <p className="mt-4 text-sm text-success" role="status">{message}</p>
  return null
}

function RunHistory({ issue, run, setSearch }) {
  if (!issue.runs?.length) return null
  return (
    <label className="flex flex-wrap items-center gap-3 text-sm text-muted">
      Experiment history
      <select className="select-pill" value={run?.id ?? ''} onChange={event => setSearch({ run: event.target.value })}>
        {issue.runs.map(item => <option key={item.id} value={item.id}>{stampId(item.created_at)} · {phases[item.phase] ?? item.phase ?? item.status}</option>)}
      </select>
    </label>
  )
}

function specFor(url, bundle) {
  const selectedId = url.get('spec')
  return bundle?.versions?.find(version => version.id === selectedId)
    ?? bundle?.versions?.find(version => version.current)
    ?? bundle?.versions?.at(-1)
}

function specText(version) {
  return `${version.markdown}\n\n## Executable numeric patch\n${JSON.stringify(version.numeric_patch, null, 2)}`
}

function SpecView({ issue, bundle, search, setSearch, command }) {
  const run = bundle?.run
  const navigate = useNavigate()
  const versions = bundle?.versions ?? []
  const current = versions.find(version => version.current) ?? versions.at(-1)
  const selected = specFor(search, bundle)
  const canEdit = Boolean(run?.capabilities?.editSpec?.enabled && current)
  const [markdown, setMarkdown] = useState('')
  const [patchText, setPatchText] = useState('[]')
  const [note, setNote] = useState('')
  const [prompt, setPrompt] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [mode, setMode] = useState('pvp')
  const [battles, setBattles] = useState(1000)
  const [seed, setSeed] = useState(42)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const keys = useRef({})

  useEffect(() => {
    setMarkdown(selected?.markdown ?? '')
    setPatchText(JSON.stringify(selected?.numeric_patch ?? [], null, 2))
    setNote('')
  }, [selected?.id])

  const setVersion = id => {
    const next = new URLSearchParams(search)
    if (id) next.set('spec', id)
    else next.delete('spec')
    setSearch(next)
  }
  const comparison = versions.find(version => version.id === search.get('compare') && version.id !== selected?.id)
    ?? versions.find(version => version.id !== selected?.id)
  const setComparison = id => {
    const next = new URLSearchParams(search)
    if (id) next.set('compare', id)
    else next.delete('compare')
    setSearch(next)
  }
  if (!run) return <StateView kind="empty" title="No experiment selected" action={<Link className="underline" to={`/issues/${issue.id}`}>Return to issue controls</Link>}>Assign a developer and push this issue to Development to start a saved experiment.</StateView>

  const patch = selected?.numeric_patch ?? []
  const editable = selected?.id === current?.id
  const capabilities = run.capabilities ?? {}
  const job = [...(bundle.jobs ?? [])].reverse().find(item =>
    ['spec_initial', 'spec_revision'].includes(item.kind) && ['queued', 'running'].includes(item.state))
  const specPending = run.lifecycle_phase === 'spec_queued'
  const specFailed = run.lifecycle_phase === 'spec_failed'
  const specStatus = specPending
    ? job?.state === 'running' ? 'Writing specification…' : phases.spec_queued
    : run.lifecycle_phase.startsWith('spec_') ? phases[run.lifecycle_phase]
      : current?.approved ? 'Specification approved' : 'Specification saved'

  const send = async (name, path, method, body, idempotent = false) => {
    setBusy(true); setError(null); setMessage(null)
    const payload = JSON.stringify(body)
    const pending = keys.current[name]
    const key = idempotent ? (pending?.payload === payload ? pending.key : crypto.randomUUID()) : null
    if (key) keys.current[name] = { key, payload }
    try {
      const result = await command(path, method, { ...body, ...(key ? { idempotencyKey: key } : {}) })
      if (idempotent) delete keys.current[name]
      setMessage('Saved. The view is reloading from backend state.')
      return result
    } catch (failure) { setError(failure.message); return null }
    finally { setBusy(false) }
  }

  const save = async event => {
    event.preventDefault()
    let numericPatch
    try { numericPatch = JSON.parse(patchText) } catch { setError('The numeric patch must be valid JSON.'); return }
    if (!Array.isArray(numericPatch)) { setError('The numeric patch must be a JSON array.'); return }
    const result = await send('save', `/runs/${run.id}/specs`, 'PATCH', {
      expectedRevision: run.revision, expectedVersion: current.version_number,
      baseSpecVersionId: selected.id, markdown, numericPatch, note, actor: ACTOR,
    })
    if (result?.version?.id) setVersion(result.version.id)
  }
  const revise = async event => {
    event.preventDefault()
    if (!prompt.trim()) return
    const result = await send('revision', `/runs/${run.id}/spec-revisions`, 'POST', {
      expectedRevision: run.revision, expectedVersion: current.version_number, prompt: prompt.trim(), actor: ACTOR,
    }, true)
    if (result) setPrompt('')
  }
  const approve = async event => {
    event.preventDefault()
    const result = await send('approve', `/runs/${run.id}/spec-approval`, 'POST', {
      expectedRevision: run.revision, actor: ACTOR, specVersionId: current.id,
      baselineConfigId: run.baseline_config_id, engineId: run.engine_id,
      numericPatch: current.numeric_patch, seed: Number(seed), mode, battles: Number(battles),
    }, true)
    if (result?.simulationId) {
      const next = new URLSearchParams(search)
      next.set('simulation', result.simulationId)
      navigate(`/issues/${issue.id}/playtest?${next}`)
    }
  }
  const reject = event => {
    event.preventDefault()
    if (!rejectReason.trim()) return
    void send('reject-spec', `/runs/${run.id}/spec-rejection`, 'POST', {
      expectedRevision: run.revision, actor: ACTOR, specVersionId: current.id, reason: rejectReason.trim(),
    }).then(result => { if (result?.acknowledged) navigate(`/issues/${issue.id}`) })
  }

  return (
    <div className="space-y-8">
      <RunHistory issue={issue} run={run} setSearch={setSearch} />
      <Section title="Development" right={<span className="text-sm text-muted">{specStatus}</span>}>
        <p className="text-sm text-muted">Review the specification and numeric patch, then approve them to start a Hexlab comparison in Testing.</p>
        {specFailed && versions.length > 0 && <p role="alert" className="mt-3 text-sm text-warning">Specification could not be generated: {run.error ?? 'No additional details.'} Your saved version is still available below.</p>}
        {run.lifecycle_phase === 'spec_failed' && <div className="mt-3">
          <Button disabled={busy || !capabilities.retrySpec?.enabled} onClick={() => void send('retry-spec', `/runs/${run.id}/spec-retry`, 'POST', {
            expectedRevision: run.revision, actor: ACTOR,
          }, true)}>Retry development</Button>
          <p className="mt-2 text-xs text-muted">{capabilities.retrySpec?.reason ?? 'Retries the Spec Writer with the saved inputs. This may incur model charges.'}</p>
        </div>}
        {specPending && versions.length > 0 && <p className="mt-3 text-sm text-info" role="status">{specStatus} Your saved version is shown below.</p>}
        {versions.length > 0 ? (
          <div className="mt-6 space-y-6">
            <label className="flex flex-wrap items-center gap-3 text-sm text-muted">Saved spec version
              <select className="select-pill" value={selected?.id ?? ''} onChange={event => setVersion(event.target.value)}>
                {versions.map(version => <option key={version.id} value={version.id}>v{version.version_number} · {version.author_kind} · {stampId(version.created_at)}{version.current ? ' · current' : ''}{version.approved ? ' · approved' : ''}</option>)}
              </select>
            </label>
            {selected && <>
              <div className="grid gap-5 lg:grid-cols-2">
                <label className="block text-sm">Specification (Markdown)
                  <textarea className={`${field} min-h-72 font-mono text-xs leading-relaxed`} readOnly={!canEdit} value={markdown} onChange={event => setMarkdown(event.target.value)} />
                </label>
                <label className="block text-sm">Executable numeric patch (JSON)
                  <textarea className={`${field} min-h-72 font-mono text-xs leading-relaxed`} readOnly={!canEdit} value={patchText} onChange={event => setPatchText(event.target.value)} />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><h3 className="text-xs text-muted">Hypothesis</h3><p>{selected.structured_spec?.hypothesis ?? 'Not provided'}</p></div>
                <div><h3 className="text-xs text-muted">Evidence assessment</h3><p>{selected.structured_spec?.evidenceAssessment ?? 'Not provided'} · {selected.structured_spec?.evidenceRationale ?? ''}</p></div>
                {selected.structured_spec?.unsupportedReason && <p className="sm:col-span-2 text-warning">Unsupported proposal: {selected.structured_spec.unsupportedReason}</p>}
              </div>
              {selected.structured_spec?.evidenceIds?.length > 0 && <p className="text-xs text-muted">Evidence IDs: {selected.structured_spec.evidenceIds.join(', ')}</p>}
              {versions.length > 1 && <details className="border-t border-border pt-4">
                <summary className="cursor-pointer font-semibold">Compare spec versions</summary>
                <label className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">Compare with
                  <select className="select-pill" value={comparison?.id ?? ''} onChange={event => setComparison(event.target.value)}>
                    {versions.filter(version => version.id !== selected.id).map(version => <option key={version.id} value={version.id}>v{version.version_number} · {version.author_kind}</option>)}
                  </select>
                </label>
                {comparison && <div className="mt-4"><DiffView oldValue={specText(comparison)} newValue={specText(selected)} leftTitle={`v${comparison.version_number}`} rightTitle={`v${selected.version_number}`} /></div>}
              </details>}
              {canEdit && <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={save}>
                <label className="text-sm text-muted">Version note<input className={field} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="What changed?" /></label>
                <div className="flex items-end"><Button type="submit" variant="primary" disabled={busy}>{editable ? 'Save as new version' : 'Restore selected as new version'}</Button></div>
              </form>}
            </>}
            {canEdit && <form className="space-y-3 border-t border-border pt-5" onSubmit={revise}>
              <label className="block text-sm text-muted">Ask the Spec Writer for a revision<textarea className={`${field} min-h-20`} maxLength={5000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Describe the change you want" /></label>
              <Button type="submit" disabled={busy || !prompt.trim()}>Request changes</Button>
            </form>}
            {canEdit && <div className="border-t border-border pt-5">
              <form className="grid gap-3 sm:grid-cols-4" onSubmit={approve}>
                <label className="text-sm text-muted">Mode<select className={field} value={mode} onChange={event => setMode(event.target.value)}><option value="pvp">PvP</option><option value="pve">PvE</option></select></label>
                <label className="text-sm text-muted">Battles<select className={field} value={battles} onChange={event => setBattles(Number(event.target.value))}>{[100, 1000, 5000, 10000].map(value => <option key={value} value={value}>{value.toLocaleString()}</option>)}</select></label>
                <label className="text-sm text-muted">Seed<input className={field} type="number" min="0" max="4294967295" value={seed} onChange={event => setSeed(event.target.value)} /></label>
                <div className="flex items-end"><Button type="submit" variant="primary" disabled={busy || !editable || !capabilities.approveSpec?.enabled || !current?.numeric_patch?.length}>Approve patch & send to Testing</Button></div>
              </form>
              {!current?.numeric_patch?.length && <p className="mt-2 text-xs text-warning">A supported numeric patch is required before approval.</p>}
              {!editable && <p className="mt-2 text-xs text-muted">Select the current spec version to approve its exact patch.</p>}
              {!capabilities.approveSpec?.enabled && <p className="mt-2 text-xs text-muted">{capabilities.approveSpec?.reason}</p>}
              <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={reject}>
                <label className="min-w-64 flex-1 text-sm text-muted">Reject this spec<input className={field} maxLength={2000} value={rejectReason} onChange={event => setRejectReason(event.target.value)} placeholder="Reason; the experiment will end" /></label>
                <Button type="submit" variant="danger" disabled={busy || !rejectReason.trim()}>Reject spec</Button>
              </form>
            </div>}
          </div>
        ) : <StateView
          kind={specFailed ? 'error' : specPending ? 'loading' : 'empty'}
          title={specFailed ? 'Specification could not be generated' : specPending ? specStatus : 'No specification yet'}
        >
          {specFailed ? run.error ?? 'Retry development to try generating the specification again.'
            : specPending ? job?.state === 'running'
              ? 'The Spec Writer is preparing the specification and numeric patch. Testing starts only after you review and approve them.'
              : 'Waiting for the Spec Writer to start. Testing has not started.'
            : 'There is no saved specification for this experiment.'}
        </StateView>}
      </Section>
      <CommandStatus busy={busy} error={error} message={message} />
    </div>
  )
}

function asPlaytest(simulation) {
  const configSnapshot = { ...simulation.baseline_config, baselineConfigId: simulation.baseline_config_id, engineId: simulation.engine_id }
  return {
    source: 'hexlab', result: simulation.result, configSnapshot,
    request: { baselineConfigId: simulation.baseline_config_id, engineId: simulation.engine_id,
      changes: simulation.numeric_patch, simulations: Number(simulation.battles), seed: Number(simulation.seed), mode: simulation.mode },
    specV: Number(simulation.version_number ?? 1), runNo: Number(simulation.generation ?? 1),
  }
}

function TestingView({ issue, bundle, search, setSearch, command, mode: viewMode, deployment }) {
  const run = bundle?.run
  const navigate = useNavigate()
  const simulations = bundle?.simulations ?? []
  const [battles, setBattles] = useState(5000)
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const keys = useRef({})
  const selected = simulations.find(item => item.id === search.get('simulation')) ?? simulations.at(-1)
  const decision = bundle?.decision
  const reviewable = selected?.state === 'succeeded'
    && Number(selected.generation) === Number(run?.simulation_generation)
    && selected.spec_version_id === run?.approved_spec_version_id

  const send = async (name, path, method, body, idempotent = false) => {
    setBusy(true); setError(null); setMessage(null)
    const payload = JSON.stringify(body)
    const pending = keys.current[name]
    const key = idempotent ? (pending?.payload === payload ? pending.key : crypto.randomUUID()) : null
    if (key) keys.current[name] = { key, payload }
    try {
      const result = await command(path, method, { ...body, ...(key ? { idempotencyKey: key } : {}) })
      if (idempotent) delete keys.current[name]
      setMessage('Saved. The view is reloading from backend state.')
      return result
    } catch (failure) { setError(failure.message); return null }
    finally { setBusy(false) }
  }
  const setSimulation = id => {
    const next = new URLSearchParams(search)
    if (id) next.set('simulation', id)
    else next.delete('simulation')
    setSearch(next)
  }
  const rerun = async event => {
    event.preventDefault()
    const result = await send('rerun', `/runs/${run.id}/simulations`, 'POST', {
      expectedRevision: run.revision, actor: ACTOR, battles: Number(battles),
    }, true)
    if (result?.simulationId) setSimulation(result.simulationId)
  }
  const back = event => {
    event.preventDefault()
    if (!reason.trim()) return
    void send('back', `/runs/${run.id}/return-to-development`, 'POST', {
      expectedRevision: run.revision, actor: ACTOR, reason: reason.trim(),
    }).then(result => { if (result?.acknowledged) navigate(`/issues/${issue.id}/spec?run=${encodeURIComponent(run.id)}`) })
  }
  const decide = decisionValue => send(`decision-${decisionValue}`, `/runs/${run.id}/decision`, 'POST', {
    expectedRevision: run.revision, actor: ACTOR, decision: decisionValue, comment,
    specVersionId: selected.spec_version_id, simulationId: selected.id,
  })

  if (!run) return <StateView kind="empty" title="No experiment selected" action={<Link className="underline" to={`/issues/${issue.id}/spec`}>Open Development</Link>} />

  const completed = simulations.filter(item => item.state === 'succeeded')
  const testingStatus = selected ? simulationStates[selected.state] ?? selected.state
    : run.lifecycle_phase === 'simulation_queued' ? phases.simulation_queued
      : run.lifecycle_phase === 'failed' ? phases.failed : 'Not started'
  const finalStatus = decision ? decision.decision === 'accept' ? 'Accepted' : 'Rejected experiment' : 'No final decision'
  return (
    <div className="space-y-8">
      <RunHistory issue={issue} run={run} setSearch={setSearch} />
      <Section title={viewMode === 'verified' ? 'Final review' : 'Testing'} right={<span className="text-sm text-muted">{viewMode === 'verified' ? finalStatus : testingStatus}</span>}>
        {simulations.length > 0 && <label className="mb-5 flex flex-wrap items-center gap-3 text-sm text-muted">Saved simulation
          <select className="select-pill" value={selected?.id ?? ''} onChange={event => setSimulation(event.target.value)}>
            {simulations.map(item => <option key={item.id} value={item.id}>{simulationStates[item.state] ?? item.state} · {Number(item.battles).toLocaleString()} battles · {stampId(item.created_at)}</option>)}
          </select>
        </label>}
        {!selected && <StateView
          kind={run.lifecycle_phase === 'failed' ? 'error' : run.lifecycle_phase === 'simulation_queued' ? 'loading' : 'empty'}
          title={run.lifecycle_phase === 'failed' ? 'Simulation could not complete' : run.lifecycle_phase === 'simulation_queued' ? 'Simulation queued' : 'Testing has not started'}
        >
          {run.lifecycle_phase === 'failed' ? run.error ?? 'Return to Development to review the patch before trying again.'
            : run.lifecycle_phase === 'simulation_queued' ? 'The approved comparison is waiting for Hexlab to start.'
              : 'Review and approve the specification in Development before running a Hexlab comparison.'}
        </StateView>}
        {selected?.state === 'queued' || selected?.state === 'running' ? <StateView kind="loading" title={simulationStates[selected.state]}>{selected.state === 'queued' ? 'Waiting for Hexlab to start. It will compare' : 'Comparing'} {Number(selected.battles).toLocaleString()} paired battles per configuration with seed {selected.seed}.</StateView> : null}
        {selected?.state === 'failed' || selected?.state === 'interrupted' ? <p role="alert" className="text-sm text-warning">{simulationStates[selected.state]}: {selected.error ?? 'No additional details.'}</p> : null}
        {selected?.state === 'succeeded' && <SimulationResults playtest={asPlaytest({ ...selected, version_number: bundle.versions?.find(version => version.id === selected.spec_version_id)?.version_number })} />}
        {viewMode !== 'verified' && ['simulation_review', 'failed'].includes(run.lifecycle_phase) && <form className="flex flex-wrap items-end gap-3 border-t border-border pt-5" onSubmit={rerun}>
          <label className="text-sm text-muted">Rerun with more battles<select className={field} value={battles} onChange={event => setBattles(Number(event.target.value))}>{[100, 1000, 5000, 10000].map(value => <option key={value} value={value}>{value.toLocaleString()}</option>)}</select></label>
          <Button type="submit" disabled={busy || !run.capabilities?.simulation?.enabled}>Re-run</Button>
        </form>}
        {viewMode !== 'verified' && run.lifecycle_phase === 'simulation_review' && reviewable && !decision && <div className="space-y-3 border-t border-border pt-5">
          <label className="block text-sm text-muted">Review comment<textarea className={`${field} min-h-20`} maxLength={5000} value={comment} onChange={event => setComment(event.target.value)} placeholder="What did you conclude from the measurements?" /></label>
          <div className="flex flex-wrap gap-3"><Button variant="primary" disabled={busy} onClick={() => void decide('accept').then(result => { if (result) navigate(`/issues/${issue.id}/verified?run=${encodeURIComponent(run.id)}`) })}>Mark verified</Button><Button variant="danger" disabled={busy} onClick={() => void decide('reject').then(result => { if (result) navigate(`/issues/${issue.id}/verified?run=${encodeURIComponent(run.id)}`) })}>Reject experiment</Button></div>
        </div>}
        {viewMode !== 'verified' && selected?.state === 'succeeded' && !reviewable && !decision && <p className="text-sm text-muted">This is a retained historical result. Final review is only available for the latest approved simulation.</p>}
        {viewMode !== 'verified' && !decision && !['accepted', 'experiment_rejected'].includes(run.lifecycle_phase) && <form className="flex flex-wrap items-end gap-3 border-t border-border pt-5" onSubmit={back}>
          <label className="min-w-64 flex-1 text-sm text-muted">Back to Development reason<input className={field} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Why should this experiment be revised?" /></label>
          <Button type="submit" variant="danger" disabled={busy || !reason.trim()}>Return to Development</Button>
        </form>}
        {(decision || ['accepted', 'experiment_rejected'].includes(run.lifecycle_phase)) && <p role="status" className="font-display text-xl font-bold">{decision?.decision === 'accept' || run.lifecycle_phase === 'accepted' ? 'Accepted' : 'Rejected experiment'}{decision?.reviewer ? ` by ${decision.reviewer}` : ''}</p>}
        {selected?.state === 'failed' && <p className="text-xs text-muted">Retry is not wired in this pass; the failed request remains in history.</p>}
        {viewMode === 'verified' && !decision && <p className="text-sm text-muted">This experiment has no saved final decision.</p>}
        {viewMode === 'verified' && (decision || ['accepted', 'experiment_rejected'].includes(run.lifecycle_phase)) && <div className="border-t border-border pt-5"><Button disabled>Push to playtest patch</Button><p className="mt-2 text-xs text-muted">{deployment?.reason ?? 'Deployment is not implemented for this workflow.'}</p></div>}
        {completed.length > 1 && <p className="text-xs text-muted">{completed.length} successful simulation runs are retained in experiment history.</p>}
      </Section>
      <CommandStatus busy={busy} error={error} message={message} />
    </div>
  )
}

export default function WorkflowPage({ mode }) {
  const { issue } = useOutletContext()
  const { state, command } = usePipeline()
  const [search, setSearch] = useSearchParams()
  const bundle = state.workflow
  const run = bundle?.run
  const runHistory = issue.runs ?? []
  const requestedRunId = search.get('run') ?? issue.backendRun?.id
  const selectedRunExists = runHistory.some(item => item.id === run?.id)
  const workflow = bundle

  if (requestedRunId && run?.id !== requestedRunId) return <StateView kind="loading" title="Loading saved experiment…" />
  if (search.get('run') && run && !selectedRunExists) return <StateView kind="error" title="Experiment does not belong to this issue" action={<Link className="underline" to={`/issues/${issue.id}`}>Back to issue</Link>} />
  if (!run && (issue.backendRun || runHistory.length)) return <StateView kind="loading" title="Loading saved experiment…" />
  if (mode === 'spec') return <SpecView issue={issue} bundle={workflow} search={search} setSearch={setSearch} command={command} />
  return <TestingView issue={issue} bundle={workflow} search={search} setSearch={setSearch} command={command} mode={mode} deployment={state.capabilities.deployment} />
}
