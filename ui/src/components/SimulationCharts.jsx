import { useId, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ErrorBar, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { comparisonChartRows, formatDelta, formatMetric } from '../simulation/results.js'

const METRICS = {
  winRate: { label: 'Win rate', unit: '%', axis: 'Win rate (%)' },
  averageDamageDealt: { label: 'Damage dealt', unit: '', axis: 'Average damage dealt' },
  averageDamageTaken: { label: 'Damage taken', unit: '', axis: 'Average damage taken' },
  averageSurvivalDuration: { label: 'Time alive', unit: 's', axis: 'Average time alive (seconds)' },
}
const GROUPS = { champions: 'Champions', items: 'Items', compositions: 'Compositions' }
const COLORS = { beforeValue: 'var(--color-muted)', afterValue: 'var(--color-accent)' }
const shorten = name => name.length > 16 ? `${name.slice(0, 15)}…` : name

function ComparisonTooltip({ active, payload, metric }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  const unit = METRICS[metric].unit
  return (
    <div className="max-w-64 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text">
      <p className="font-semibold">{row.name}</p>
      <p className="mt-1">Baseline: {formatMetric(row.beforeValue)}{unit} · {row.beforeSamples.toLocaleString()} samples</p>
      <p className="mt-1">Patched: {formatMetric(row.afterValue)}{unit} · {row.afterSamples.toLocaleString()} samples</p>
      <p className="mt-1 text-muted">Change: {formatDelta(row.beforeValue, row.afterValue, metric === 'winRate' ? ' pp' : unit)}</p>
    </div>
  )
}

function ComparisonPlot({ playtest, group, metric, title, control }) {
  const titleId = useId()
  const { rows, total } = comparisonChartRows(playtest, group, metric, group === 'compositions' ? 8 : Infinity)
  const definition = METRICS[metric]
  const first = rows[0]
  const height = Math.max(220, rows.length * 46 + 44)
  const isRate = metric === 'winRate'
  return (
    <figure aria-labelledby={titleId} className="min-w-0">
      <figcaption>
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
          <h3 id={titleId} className="text-sm font-semibold">{title}</h3>
          {control}
        </div>
        {first && <p className="mt-2 text-sm tabular-nums text-muted">
          <span className="font-semibold text-text">{first.name}</span>: {formatMetric(first.beforeValue)}{definition.unit} → {formatMetric(first.afterValue)}{definition.unit}
          {' '}({formatDelta(first.beforeValue, first.afterValue, isRate ? ' pp' : definition.unit)})
        </p>}
        <p className="mt-1 text-xs text-muted">{isRate ? '0–100% scale. Whiskers show descriptive 95% win-rate intervals.' : `${definition.axis}; bars start at zero.`}</p>
      </figcaption>
      {rows.length ? (
        <>
          <div className="mt-4 min-w-0" style={{ height }} aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 12, bottom: 12, left: 0 }} barGap={3} barCategoryGap={12}>
                <CartesianGrid horizontal={false} stroke="var(--color-border)" />
                <XAxis type="number" domain={isRate ? [0, 100] : [0, 'auto']} ticks={isRate ? [0, 25, 50, 75, 100] : undefined}
                  tickFormatter={value => `${Number(value).toLocaleString()}${isRate ? '%' : ''}`} tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
                  axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={104} interval={0} tickFormatter={shorten}
                  tick={{ fill: 'var(--color-text)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ComparisonTooltip metric={metric} />} cursor={{ fill: 'var(--color-surface-2)' }} />
                <Bar dataKey="beforeValue" name="Baseline" fill={COLORS.beforeValue} maxBarSize={12} isAnimationActive={false}>
                  {isRate && <ErrorBar dataKey="beforeInterval" width={3} stroke="var(--color-text)" strokeWidth={1} isAnimationActive={false} />}
                </Bar>
                <Bar dataKey="afterValue" name="Patched" fill={COLORS.afterValue} maxBarSize={12} isAnimationActive={false}>
                  {isRate && <ErrorBar dataKey="afterInterval" width={3} stroke="var(--color-text)" strokeWidth={1} isAnimationActive={false} />}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {total > rows.length && <p className="mt-1 text-xs text-muted">Showing the {rows.length} most-sampled compositions out of {total}. Full results are in the composition table below.</p>}
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted hover:text-text">View chart data as a table</summary>
            <div role="region" aria-label={`${title} chart data`} tabIndex={0} className="mt-3 overflow-x-auto rounded-md">
              <table className="w-full min-w-80 text-left tabular-nums">
                <thead><tr className="text-muted">{['Target', 'Baseline', 'Patched', 'Change', 'Samples before / after'].map(label => <th key={label} scope="col" className="py-2 pr-3 font-normal">{label}</th>)}</tr></thead>
                <tbody>{rows.map(row => <tr key={row.id} className="border-t border-border">
                  <th scope="row" className="py-2 pr-3 font-normal">{row.name}</th>
                  <td className="py-2 pr-3">{formatMetric(row.beforeValue)}{definition.unit}</td>
                  <td className="py-2 pr-3">{formatMetric(row.afterValue)}{definition.unit}</td>
                  <td className="py-2 pr-3">{formatDelta(row.beforeValue, row.afterValue, isRate ? ' pp' : definition.unit)}</td>
                  <td className="py-2 pr-3">{row.beforeSamples.toLocaleString()} / {row.afterSamples.toLocaleString()}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </details>
        </>
      ) : <p className="py-8 text-sm text-muted">No eligible samples were recorded for this comparison. Zero-sample results are omitted from the graph.</p>}
    </figure>
  )
}

/** Every plotted point comes directly from the completed experiment. */
export default function SimulationCharts({ playtest }) {
  const [group, setGroup] = useState('champions')
  const [metric, setMetric] = useState('averageDamageDealt')
  return (
    <section aria-labelledby="simulation-charts" className="min-w-0 space-y-5 border-t border-border pt-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="simulation-charts" className="font-display text-xl font-bold">Performance comparison</h2>
          <p className="mt-2 text-sm text-muted">Compare the measured baseline and patched outcomes across the roster.</p>
        </div>
        <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
          Compare
          <select aria-label="Chart comparison group" value={group} onChange={event => setGroup(event.target.value)} className="select-pill">
            {Object.entries(GROUPS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-5 text-xs text-muted" aria-label="Chart legend">
        <span className="flex items-center gap-2"><span aria-hidden="true" className="h-2.5 w-5 rounded-sm bg-muted" />Baseline</span>
        <span className="flex items-center gap-2"><span aria-hidden="true" className="h-2.5 w-5 rounded-sm bg-accent" />Patched</span>
      </div>
      <div className="grid min-w-0 gap-8 lg:grid-cols-2">
        <ComparisonPlot playtest={playtest} group={group} metric="winRate" title={`${GROUPS[group]} · win rate`} />
        <ComparisonPlot playtest={playtest} group={group} metric={metric} title={`${GROUPS[group]} · ${METRICS[metric].label.toLowerCase()}`} control={
          <select aria-label="Performance chart metric" value={metric} onChange={event => setMetric(event.target.value)} className="select-pill max-w-full">
            {Object.entries(METRICS).filter(([key]) => key !== 'winRate').map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </select>
        } />
      </div>
    </section>
  )
}
