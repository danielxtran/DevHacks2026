import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { usePipeline } from '../store/pipeline'
import { canVerifySimulation } from '../store/reducer'
import { AgentActivityPanel, ApprovalGate } from '../components/pipelineParts'
import { StatCard, VerdictBanner } from '../components/evidence'
import { CompWinRates, ConvergenceChart } from '../components/charts'
import BuildSummary from '../components/BuildSummary'
import SimulationResults from '../components/SimulationResults'
import { Button, ErrorPanel, Skeleton, StateView, VersionPicker } from '../components/ui'
import { num } from '../components/format'
import { reviewBlockReason } from '../simulation/results'

const runLine = (pt) => pt?.source === 'hexlab'
  ? `${num(pt.result?.simulations ?? pt.request?.simulations ?? 0)} battles per configuration · seed ${pt.result?.seed ?? pt.request?.seed ?? '—'}`
  : `${num(pt?.matches ?? 0)} illustrative matches · demo data`
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

function Rerun({ issue, disabled }) {
  const { dispatch } = usePipeline()
  const [n, setN] = useState(5000)
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <select aria-label="Battles per configuration" value={n} disabled={disabled} onChange={(e) => setN(Number(e.target.value))} className="select-pill max-w-full disabled:cursor-not-allowed disabled:opacity-60">
        {[100, 1000, 5000, 10000].map((v) => <option key={v} value={v}>{num(v)} battles per configuration</option>)}
      </select>
      <Button size="sm" disabled={disabled} onClick={() => dispatch({ type: 'PLAYTEST_RERUN', id: issue.id, matches: n })}>Re-run</Button>
    </span>
  )
}

export default function PlaytestResults({ view = 'playtest' }) {
  const { issue } = useOutletContext()
  const navigate = useNavigate()
  const { dispatch, simulation } = usePipeline()
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
  const idx = picked != null && picked >= 0 && picked <= newest ? picked : newest
  const entry = history[idx]
  const isCurrent = !!pt && idx === newest
  const shownPt = isCurrent ? pt : entry
  const realResult = shownPt?.source === 'hexlab'
  const blockReason = shownPt ? reviewBlockReason(issue, shownPt, simulation?.config)
    || (inPlaytest && !canVerifySimulation(issue) ? 'Only the latest completed simulation for the approved patch can be verified.' : null) : null
  const rerunBlockReason = shownPt ? reviewBlockReason({ ...issue, error: null }, shownPt, simulation?.config) : null
  const backToSpec = () => navigate(`/issues/${issue.id}/spec`)
  const returnToDevelopment = (comment) => {
    dispatch({ type: 'PLAYTEST_REJECT', id: issue.id, comment })
    backToSpec()
  }

  if (view === 'verified' && !verified) {
    return <StateView kind="empty" title="Not verified yet">Review the measured simulation results on the Playtest page, then mark the change verified.</StateView>
  }

  if (!pt && !busy && !(issue.error && inPlaytest) && !history.length) {
    return <StateView kind="empty" title="No simulation yet" action={<Button to={`/issues/${issue.id}/spec`}>Open Development</Button>}>Prepare the stat patch in Development, then approve the spec to compare the baseline and patched configurations.</StateView>
  }

  return (
    <div className="space-y-10">
      {simulation?.error && inPlaytest && (
        <ErrorPanel error={{ title: 'Simulator connection unavailable', message: simulation.error }} onRetry={simulation.reload} />
      )}
      {issue.error && inPlaytest && (
        <div className="space-y-3">
          <ErrorPanel error={issue.error} onRetry={issue.error.run ? () => dispatch({ type: 'RETRY_RUN', id: issue.id }) : undefined} />
          <Button variant="danger" onClick={() => returnToDevelopment('Returned to Development after the test could not complete')}>
            Back to development
          </Button>
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
              ? <>Earlier result{entry.outcome ? ` (${entry.outcome})` : ''} · {runLine(entry)}.{pt && <> <button type="button" className="underline underline-offset-4 hover:text-text" onClick={() => setPicked(null)}>Back to current</button></>}</>
              : runLine(shownPt)
          }
        />
      )}
      <AgentActivityPanel issueId={issue.id} />
      {verified && view === 'verified' && isCurrent && (
        <p role="status" className="font-display text-2xl font-bold tracking-tight">
          <span aria-hidden className="text-success">✓ </span>{realResult ? 'Verified' : 'Demo verification'} by {issue.approvals.playtest?.by}.
        </p>
      )}
      {building && (
        <p className="text-sm text-muted">
          Building attempt {issue.run.attempt} of spec v{issue.approvals.spec?.v ?? issue.specVersions.length} in the background.
          {issue.run.attempt > 1 && ' The last attempt failed a check, so the Builder is trying again.'} Bots start playing once every check passes.
        </p>
      )}
      {busy && !pt && <Skeleton className="h-24" />}
      {running && issue.run?.kind === 'simulation' && (
        <div className="space-y-3">
          <p role="status" className="text-sm text-muted">
            Comparing {num(issue.run.request.simulations)} battles per configuration for spec v{issue.run.specV}, using seed {issue.run.request.seed}.
            The baseline and patch use identical matchups. Results will appear here when both batches finish.
          </p>
          <Button variant="ghost" onClick={() => returnToDevelopment('Returned to Development to revise the simulation patch')}>Return to Development</Button>
        </div>
      )}

      {shownPt && (() => { const pt = shownPt; return (
        <div className={`space-y-10 ${running && isCurrent ? 'opacity-50' : ''}`} aria-busy={running && isCurrent}>
          {realResult ? <SimulationResults playtest={pt} /> : (
            <>
              <p className="rounded-md bg-surface p-4 text-sm text-warning">Illustrative demo results. These values were generated for the prototype and did not come from Hexlab. Return to Development to prepare and test a real stat patch.</p>
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
            </>
          )}

          {realResult && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-sm text-muted">
              <span>{runLine(pt)} · run {pt.runNo}.</span>
              {!verified && isCurrent && <Rerun issue={issue} disabled={busy || Boolean(rerunBlockReason)} />}
            </div>
          )}

          {!realResult && isCurrent && inPlaytest && (
            <Button onClick={() => returnToDevelopment('Prepare a supported Hexlab patch and replace illustrative playtest data')}>Prepare a real simulation in Development</Button>
          )}

          {realResult && isCurrent && (inPlaytest || verified) && (
            <ApprovalGate
              approveLabel="Mark verified"
              approval={issue.approvals.playtest}
              disabled={Boolean(blockReason)}
              disabledReason={blockReason}
              note={<p className="max-w-3xl text-sm text-muted">Verification records your review of this spec and simulation. Check the edited stats, measured effects, sample counts, and uncertainty before accepting.</p>}
              onApprove={(comment) => {
                if (reviewBlockReason(issue, pt, simulation?.config) || !canVerifySimulation(issue)) return
                dispatch({ type: 'PLAYTEST_VERIFY', id: issue.id, comment })
                navigate(`/issues/${issue.id}/verified`)
              }}
              onReject={(comment) => {
                returnToDevelopment(comment)
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
