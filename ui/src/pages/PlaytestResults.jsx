import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { usePipeline } from '../store/pipeline'
import { AgentActivityPanel, ApprovalGate } from '../components/pipelineParts'
import { StatCard, VerdictBanner } from '../components/evidence'
import { CompWinRates, ConvergenceChart } from '../components/charts'
import BuildSummary from '../components/BuildSummary'
import { Button, ErrorPanel, Skeleton, StateView, VersionPicker } from '../components/ui'
import { num } from '../components/format'

const runLine = (pt) => `${num(pt.matches)} simulated matches · ${pt.botsPerMatch ?? 8} bot players each`
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** Matches run · avg damage dealt · avg time alive (spec 6.2.3). */
function SimStats({ pt }) {
  const cards = [
    ['Matches run', num(pt.matches), `${pt.botsPerMatch ?? 8} bots per match`],
    ['Avg damage dealt', pt.avgDamage?.after, pt.avgDamage && `was ${pt.avgDamage.before}`],
    ['Avg time alive', pt.avgTimeAlive && mmss(pt.avgTimeAlive.after), pt.avgTimeAlive && `was ${mmss(pt.avgTimeAlive.before)}`],
  ]
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map(([label, value, sub]) => (
        <div key={label} className="rounded-lg bg-surface p-4">
          <div className="text-xs text-muted">{label}</div>
          <div className="mt-1 text-3xl font-bold tabular-nums">{value ?? '—'}</div>
          {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
        </div>
      ))}
    </div>
  )
}

const CAUTION = {
  not_supported: 'Live stats don’t back the original complaint, so this change may not be needed.',
  inconclusive: 'The result is within noise. Re-run with more matches before verifying.',
  partial: 'The metric improved but is still outside the target range.',
  failed: 'The change didn’t move the metric toward the target.',
}

function Rerun({ issue, disabled }) {
  const { dispatch } = usePipeline()
  const [n, setN] = useState(5000)
  return (
    <span className="inline-flex items-center gap-2">
      <select aria-label="Matches" value={n} onChange={(e) => setN(Number(e.target.value))} className="select-pill">
        {[200, 1000, 2000, 5000].map((v) => <option key={v} value={v}>{num(v)} matches</option>)}
      </select>
      <Button size="sm" disabled={disabled} onClick={() => dispatch({ type: 'PLAYTEST_RERUN', id: issue.id, matches: n })}>Re-run</Button>
    </span>
  )
}

export default function PlaytestResults({ view = 'playtest' }) {
  const { issue } = useOutletContext()
  const navigate = useNavigate()
  const { dispatch } = usePipeline()
  const pt = issue.playtest
  const building = issue.run?.agent === 'build'
  const running = issue.run?.agent === 'playtest'
  const busy = building || running
  const inPlaytest = issue.stage === 'playtest'
  const verified = issue.stage === 'verified'
  const [picked, setPicked] = useState(null) // index into history; null = newest

  // Every playtest run is kept. The newest one is "current" while the issue is still in this cycle.
  const history = issue.playtests ?? []
  const newest = history.length - 1
  const idx = picked ?? newest
  const entry = history[idx]
  const isCurrent = !!pt && idx === newest
  const shownPt = isCurrent ? pt : entry
  const backToSpec = () => navigate(`/issues/${issue.id}/spec`)

  if (view === 'verified' && !verified) {
    return <StateView kind="empty" title="Not verified yet">A person marks the change verified on the Playtest page once the bots finish.</StateView>
  }

  if (!pt && !busy && !(issue.error && inPlaytest) && !history.length) {
    return <StateView kind="empty" title="No playtest yet">Approve the spec. The Builder makes the change in the background, and bots start playing once every check passes.</StateView>
  }

  return (
    <div className="space-y-10">
      {issue.error && inPlaytest && (
        <div className="space-y-3">
          <ErrorPanel error={issue.error} onRetry={() => dispatch({ type: 'RETRY_RUN', id: issue.id })} />
          {!pt && issue.error.run?.agent === 'build' && (
            <Button variant="danger" onClick={() => { dispatch({ type: 'PLAYTEST_REJECT', id: issue.id, comment: 'Build checks kept failing' }); backToSpec() }}>
              Back to spec
            </Button>
          )}
        </div>
      )}
      {history.length > 0 && (
        <VersionPicker
          label="Playtest version"
          value={idx}
          onChange={(v) => setPicked(v === newest ? null : v)}
          options={[...history.keys()].reverse().map((k) => {
            const h = history[k]
            const tag = h.outcome ?? (k === newest && pt ? 'current' : null)
            return [k, `Spec v${h.specV} · run ${h.runNo}${tag ? ` · ${tag}` : ''}`]
          })}
          note={
            !isCurrent && entry
              ? <>Earlier result{entry.outcome ? ` (${entry.outcome})` : ''} from {num(entry.matches)} matches.{pt && <> <button type="button" className="underline underline-offset-4 hover:text-text" onClick={() => setPicked(null)}>Back to current</button></>}</>
              : runLine(shownPt)
          }
        />
      )}
      <AgentActivityPanel issueId={issue.id} />
      {verified && view === 'verified' && (
        <p role="status" className="font-display text-2xl font-bold tracking-tight">
          <span aria-hidden className="text-success">✓ </span>Verified by {issue.approvals.playtest?.by}.
        </p>
      )}
      {building && (
        <p className="text-sm text-muted">
          Building attempt {issue.run.attempt} of spec v{issue.approvals.spec?.v ?? issue.specVersions.length} in the background.
          {issue.run.attempt > 1 && ' The last attempt failed a check, so the Builder is trying again.'} Bots start playing once every check passes.
        </p>
      )}
      {busy && !pt && <Skeleton className="h-24" />}

      {shownPt && (() => { const pt = shownPt; return (
        <div className={`space-y-10 ${running && isCurrent ? 'opacity-50' : ''}`} aria-busy={running && isCurrent}>
          <SimStats pt={pt} />
          {pt.compWinRates && <CompWinRates rows={pt.compWinRates} />}

          <VerdictBanner playtest={pt} />

          <div className="grid gap-8 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label={pt.metric.name} before={pt.metric.before} after={pt.metric.after} unit={pt.metric.unit} ci={pt.metric.ci} target={pt.metric.target} />
            {pt.secondary.map((s) => (
              <StatCard key={s.name} label={s.name} before={s.before} after={s.after} unit={s.unit} ci={s.ci} />
            ))}
          </div>

          <ConvergenceChart playtest={pt} />

          <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span>
              {num(pt.matches)} bot matches per build (run {pt.runNo}).{' '}
              {pt.matches < 1000 ? 'Small sample: differences of a few points are noise.' : `95% confidence ±${pt.metric.ci}${pt.metric.unit}.`}
            </span>
            {!verified && isCurrent && <Rerun issue={issue} disabled={busy} />}
          </p>

          {isCurrent && (inPlaytest || verified) && (
            <ApprovalGate
              approveLabel="Mark verified"
              approval={issue.approvals.playtest}
              disabled={busy}
              disabledReason={busy ? 'Wait for the bots to finish.' : null}
              note={CAUTION[pt.overall] && <p className="text-sm"><span aria-hidden className="text-warning">! </span>{CAUTION[pt.overall]}</p>}
              onApprove={(comment) => {
                dispatch({ type: 'PLAYTEST_VERIFY', id: issue.id, comment })
                navigate(`/issues/${issue.id}/verified`)
              }}
              onReject={(comment) => {
                dispatch({ type: 'PLAYTEST_REJECT', id: issue.id, comment })
                backToSpec()
              }}
              rejectLabel="← Back to development"
            />
          )}
        </div>
      )})()}

      {isCurrent || !entry ? <BuildSummary build={issue.build} builds={issue.builds} /> : <BuildSummary build={entry.build} builds={entry.builds} />}

      {view === 'verified' && verified && (
        <div className="border-t border-border pt-6">
          <Button variant="primary" disabled aria-describedby="patch-note">Push to playtest patch</Button>
          <p id="patch-note" className="mt-2 text-sm text-muted">Not connected yet. This will send the verified change to the next playtest patch.</p>
        </div>
      )}
    </div>
  )
}
