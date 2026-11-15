import { formatDelta, formatMetric, hasSamples, patchRows, performanceRows, replayUrl } from '../simulation/results'
import { Button } from './ui'
import { validateSimulationResult } from '../simulation/client.js'
import SimulationCharts from './SimulationCharts'

const count = (value) => Number.isFinite(value) ? value.toLocaleString() : '—'
const statValue = (value) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'
const statDelta = (before, after) => Number.isFinite(before) && Number.isFinite(after)
  ? `${after > before ? '+' : ''}${statValue(after - before)}`
  : '—'

function ChangePair({ before, after, unit = '', rate = false, available = true }) {
  if (!available) return <span className="text-muted">No eligible samples</span>
  return (
    <div className="whitespace-nowrap tabular-nums">
      <span className="text-muted">{formatMetric(before)}{unit}</span>
      <span aria-label="to" className="mx-1.5 text-muted">→</span>
      <span>{formatMetric(after)}{unit}</span>
      <div className="mt-0.5 text-xs text-muted">{formatDelta(before, after, rate ? ' pp' : unit)}</div>
    </div>
  )
}

function Interval({ metric }) {
  if (!hasSamples(metric) || !Array.isArray(metric.confidenceInterval)) return <span>—</span>
  return <span>{formatMetric(metric.confidenceInterval[0])}–{formatMetric(metric.confidenceInterval[1])}%</span>
}

function PerformanceTable({ rows, label, composition = false }) {
  if (!rows.length) return <p className="text-sm text-muted">No eligible {label.toLowerCase()} samples were recorded.</p>
  return (
    <div role="region" aria-label={`${label} results table`} tabIndex={0} className="max-w-full overflow-x-auto rounded-md focus-visible:outline-offset-4">
      <table className="w-full min-w-[58rem] text-left text-sm tabular-nums">
        <caption className="sr-only">{label}. Each row shows baseline and patched values, after-minus-before changes, eligible samples, and 95% win-rate intervals.</caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted">
            <th scope="col" className="min-w-36 py-3 pr-5 font-normal">{composition ? 'Composition' : label === 'Champion performance' ? 'Champion' : 'Item'}</th>
            <th scope="col" className="py-3 pr-5 font-normal">Win rate</th>
            <th scope="col" className="py-3 pr-5 font-normal">95% interval</th>
            <th scope="col" className="py-3 pr-5 font-normal">Samples</th>
            <th scope="col" className="py-3 pr-5 font-normal">Damage dealt</th>
            <th scope="col" className="py-3 pr-5 font-normal">Damage taken</th>
            <th scope="col" className="py-3 font-normal">Time alive</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const before = row.before
            const after = row.after
            const available = hasSamples(before) && hasSamples(after)
            return (
              <tr key={row.id} className="border-b border-border last:border-0">
                <th scope="row" className="py-4 pr-5 font-normal">
                  <span className={row.modified ? 'font-semibold text-accent-text' : ''}>{row.name}</span>
                  {row.modified && <span className="mt-0.5 block text-xs text-muted">Stat edited</span>}
                </th>
                <td className="py-4 pr-5"><ChangePair before={before?.winRate} after={after?.winRate} unit="%" rate available={available} /></td>
                <td className="whitespace-nowrap py-4 pr-5 text-xs">
                  <span className="block text-muted"><span className="sr-only">Baseline: </span><Interval metric={before} /></span>
                  <span className="mt-1 block"><span className="sr-only">Patched: </span><Interval metric={after} /></span>
                </td>
                <td className="whitespace-nowrap py-4 pr-5">
                  <span className="text-muted">{count(before?.samples)}</span><span aria-label="to" className="mx-1.5 text-muted">→</span>{count(after?.samples)}
                </td>
                <td className="py-4 pr-5"><ChangePair before={before?.averageDamageDealt} after={after?.averageDamageDealt} available={available} /></td>
                <td className="py-4 pr-5"><ChangePair before={before?.averageDamageTaken} after={after?.averageDamageTaken} available={available} /></td>
                <td className="py-4"><ChangePair before={before?.averageSurvivalDuration} after={after?.averageSurvivalDuration} unit="s" available={available} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function SimulationResults({ playtest }) {
  const result = playtest.result
  if (!validateSimulationResult(result, playtest.request).valid) {
    return <p role="alert" className="text-sm text-warning">The saved simulation result is incomplete. Run the comparison again before reviewing it.</p>
  }
  const patches = patchRows(playtest)
  const champions = performanceRows(playtest, 'champions')
  const items = performanceRows(playtest, 'items')
  const compositions = performanceRows(playtest, 'compositions')
  const isPve = result.mode === 'pve'

  return (
    <div className="min-w-0 space-y-9">
      <section aria-labelledby="simulation-complete">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h2 id="simulation-complete" className="font-display text-2xl font-bold">Measured simulation results</h2>
          {replayUrl(playtest) && (
            <Button size="sm" href={replayUrl(playtest)} target="_blank" rel="noreferrer">
              Watch replays in Hexlab <span aria-hidden>↗</span><span className="sr-only">(opens in a new tab)</span>
            </Button>
          )}
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          Baseline and patched stats were tested against the same seeded matchups. Review the effects across the roster before verifying this change.
        </p>
        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div><dt className="text-muted">Battles per configuration</dt><dd className="mt-0.5 font-semibold tabular-nums">{count(result.simulations)}</dd></div>
          <div><dt className="text-muted">Total battles</dt><dd className="mt-0.5 font-semibold tabular-nums">{count(result.before.games + result.after.games)}</dd></div>
          <div><dt className="text-muted">Mode</dt><dd className="mt-0.5">{isPve ? 'PvE · clear Krug' : 'PvP · 3 vs 3'}</dd></div>
          <div><dt className="text-muted">Seed</dt><dd className="mt-0.5 tabular-nums">{result.seed}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="tested-stat-changes" className="border-t border-border pt-5">
        <h2 id="tested-stat-changes" className="font-display text-xl font-bold">Stat changes tested</h2>
        <div role="region" aria-label="Tested stat changes table" tabIndex={0} className="mt-3 overflow-x-auto rounded-md">
          <table className="w-full min-w-[30rem] text-left text-sm tabular-nums">
            <thead><tr className="border-b border-border text-xs text-muted">
              {['Target', 'Stat', 'Baseline', 'Patched', 'Change'].map((heading) => <th key={heading} scope="col" className="py-2 pr-4 font-normal">{heading}</th>)}
            </tr></thead>
            <tbody>{patches.map((patch) => (
              <tr key={`${patch.type}-${patch.id}-${patch.stat}`} className="border-b border-border last:border-0">
                <th scope="row" className="py-3 pr-4 font-semibold">{patch.name}<span className="ml-2 text-xs font-normal text-muted">{patch.type}</span></th>
                <td className="py-3 pr-4">{patch.label}</td>
                <td className="py-3 pr-4 text-muted">{statValue(patch.before)}</td>
                <td className="py-3 pr-4">{statValue(patch.after)}</td>
                <td className="py-3 pr-4">{statDelta(patch.before, patch.after)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      {isPve && (
        <section aria-labelledby="pve-clear-rate" className="border-t border-border pt-5">
          <h2 id="pve-clear-rate" className="font-display text-xl font-bold">Krug clear rate</h2>
          <div className="mt-3 text-lg"><ChangePair before={result.before.clearRate} after={result.after.clearRate} unit="%" rate /></div>
          <p className="mt-2 text-sm text-muted">Player-team clears across all {count(result.simulations)} matchups per configuration.</p>
        </section>
      )}

      <SimulationCharts playtest={playtest} />

      <section aria-labelledby="champion-performance" className="border-t border-border pt-5">
        <h2 id="champion-performance" className="font-display text-xl font-bold">Champion performance</h2>
        <p className="mt-2 text-sm text-muted">Baseline → patched, with the change underneath. Win-rate changes are percentage points (pp); time alive is in seconds.</p>
        <PerformanceTable rows={champions} label="Champion performance" />
      </section>

      <details className="border-t border-border pt-5">
        <summary className="cursor-pointer font-display text-xl font-bold">Item performance <span className="font-sans text-sm font-normal text-muted">({items.length})</span></summary>
        <p className="mt-3 text-sm text-muted">Samples count eligible team appearances containing the item. Damage and survival average its holders in that appearance.</p>
        <PerformanceTable rows={items} label="Item performance" />
      </details>

      <details className="border-t border-border pt-5">
        <summary className="cursor-pointer font-display text-xl font-bold">Composition performance <span className="font-sans text-sm font-normal text-muted">({compositions.length})</span></summary>
        <p className="mt-3 text-sm text-muted">Most-sampled compositions first. Damage is the team total; survival averages team members. Small samples need particular care.</p>
        <PerformanceTable rows={compositions} label="Composition performance" composition />
      </details>

      <section aria-labelledby="simulation-method" className="border-t border-border pt-5">
        <h2 id="simulation-method" className="text-sm font-semibold">How to read this comparison</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          Champion samples count eligible team appearances. Draws count as non-wins. The 95% win-rate intervals are descriptive, approximate estimates; shared teams and side-swapped games are correlated. These intervals do not establish that a patch improves balance. Results describe this simplified simulator, rather than live TFT telemetry.
        </p>
        <p className="mt-2 text-sm text-muted">Draws: {count(result.before.draws)} baseline → {count(result.after.draws)} patched.</p>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted hover:text-text">Experiment details</summary>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><dt className="text-xs text-muted">Baseline configuration</dt><dd className="mt-1 break-all font-mono text-xs">{result.baselineConfigId}</dd></div>
            <div><dt className="text-xs text-muted">Evaluation time</dt><dd className="mt-1 tabular-nums">{formatMetric(result.evaluationDurationMs / 1000, 2)}s</dd></div>
          </dl>
          <p className="mt-4 max-w-3xl text-xs leading-relaxed text-muted">{result.methodology}</p>
          <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-surface p-4 text-xs">{JSON.stringify(playtest.request, null, 2)}</pre>
        </details>
      </section>
    </div>
  )
}
