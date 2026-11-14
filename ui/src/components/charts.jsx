import { useTheme } from '../hooks/useTheme'
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

// Two-series palette validated for the dark surface (dataviz validator: all checks pass,
// CVD ΔE ≥ 20). Text never uses these colors; they mark identity only.
export const SERIES = { before: '#4F8FD6', after: '#D4703A' }
export const SINGLE = '#E0605F'

// Chart chrome per theme (SVG attributes can't read CSS variables, so these mirror index.css).
const CHROME = {
  dark: { line: '#2B2A29', tick: '#ADACAA', text: '#E7E6E3', dot: '#161615', target: '#62B48A' },
  light: { line: '#DBD9D6', tick: '#656462', text: '#2B2A29', dot: '#FFFFFF', target: '#2E7D57' },
}

function useChrome() {
  const [theme] = useTheme()
  const c = CHROME[theme]
  return {
    c,
    axis: { stroke: c.line, tick: { fill: c.tick, fontSize: 11, fontFamily: 'Inter, sans-serif' }, tickLine: false },
    grid: <CartesianGrid stroke={c.line} strokeDasharray="0" vertical={false} />,
  }
}

function TipBox({ active, payload, label, unit = '', labelFmt = (l) => l }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-mono text-muted">{labelFmt(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-text">
          <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: p.color || p.payload.fill }} />
          {p.name}: <strong>{p.value}{unit}</strong>
        </div>
      ))}
    </div>
  )
}

/** Chart wrapper: the text summary is always visible (accessibility). */
export function ChartFrame({ title, summary, children, height = 220, table }) {
  return (
    <figure>
      <figcaption className="mb-3">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-sm text-muted">{summary}</div>
      </figcaption>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
      {table && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted hover:text-text">View as table</summary>
          <div className="mt-2 max-h-48 overflow-auto">{table}</div>
        </details>
      )}
    </figure>
  )
}

export function DataTable({ cols, rows }) {
  return (
    <table className="w-full text-left font-mono">
      <thead>
        <tr className="text-muted">{cols.map((c) => <th key={c} className="py-1 pr-4 font-normal">{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-border">{r.map((v, j) => <td key={j} className="py-1 pr-4">{v}</td>)}</tr>
        ))}
      </tbody>
    </table>
  )
}

export function MentionTrend({ trend }) {
  const { c, axis, grid } = useChrome()
  const today = new Date()
  const data = trend.map((v, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (trend.length - 1 - i))
    return { day: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), mentions: v }
  })
  const first = trend[0]
  const last = trend.at(-1)
  return (
    <ChartFrame
      title="Mentions per day · last 14 days"
      summary={`${first} → ${last} mentions/day (${last >= first ? '+' : ''}${Math.round(((last - first) / Math.max(first, 1)) * 100)}%).`}
      height={140}
      table={<DataTable cols={['day', 'mentions']} rows={data.map((d) => [d.day, d.mentions])} />}
    >
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        {grid}
        <XAxis dataKey="day" {...axis} interval={3} />
        <YAxis {...axis} axisLine={false} width={44} />
        <Tooltip content={<TipBox />} cursor={{ stroke: c.tick, strokeWidth: 1 }} />
        <Area isAnimationActive={false} type="monotone" dataKey="mentions" name="Mentions" stroke={SINGLE} strokeWidth={2} fill={SINGLE} fillOpacity={0.08} activeDot={{ r: 4, stroke: c.dot, strokeWidth: 2 }} />
      </AreaChart>
    </ChartFrame>
  )
}

export function ConvergenceChart({ playtest }) {
  const { c, axis, grid } = useChrome()
  const m = playtest.metric
  const s = playtest.series
  return (
    <ChartFrame
      title={`${m.name} as matches accumulate`}
      summary={`Old build settles at ${m.before}${m.unit}, new build at ${m.after}${m.unit} after ${s.at(-1).matches.toLocaleString()} matches each. Shaded band = target ${m.target[0]}–${m.target[1]}${m.unit}.`}
      table={<DataTable cols={['matches', 'old build', 'new build']} rows={s.map((r) => [r.matches, `${r.before}${m.unit}`, `${r.after}${m.unit}`])} />}
    >
      <LineChart data={s} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
        {grid}
        <ReferenceArea y1={m.target[0]} y2={m.target[1]} fill={c.target} fillOpacity={0.1} />
        <XAxis dataKey="matches" {...axis} />
        <YAxis {...axis} axisLine={false} width={48} domain={['auto', 'auto']} />
        <Tooltip content={<TipBox unit={m.unit} labelFmt={(l) => `${l} matches`} />} cursor={{ stroke: c.tick, strokeWidth: 1 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" formatter={(v) => <span style={{ color: c.text }}>{v}</span>} />
        <Line isAnimationActive={false} type="monotone" dataKey="before" name="Old build" stroke={SERIES.before} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: c.dot, strokeWidth: 2 }} />
        <Line isAnimationActive={false} type="monotone" dataKey="after" name="New build" stroke={SERIES.after} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: c.dot, strokeWidth: 2 }} />
      </LineChart>
    </ChartFrame>
  )
}

// Before/after colors from the spec (before = grey, after = red), with the grey lightened per theme
// so it clears 3:1 against the surface (dataviz validator: contrast + CVD pass; grey by design).
const BA = { dark: { before: '#9A968F', after: '#D13639' }, light: { before: '#8A8782', after: '#D13639' } }

const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)}`

/** Win rate per team comp: a before/after bar pair per comp with a text readout (spec 6.2.3). */
export function CompWinRates({ rows }) {
  const [theme] = useTheme()
  const c = BA[theme]
  const max = Math.ceil(Math.max(...rows.flatMap((r) => [r.before, r.after])) / 10) * 10
  const bar = (v, color, label) => (
    <div className="h-2.5 rounded-r-[4px]" style={{ width: `${(v / max) * 100}%`, background: color }} title={label} />
  )
  return (
    <figure>
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">Win rate per team comp</span>
        <span className="flex gap-4 text-xs text-muted" aria-hidden>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.before }} />Before</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.after }} />After</span>
        </span>
      </figcaption>
      <ul className="space-y-3">
        {rows.map((r) => {
          const d = Math.round((r.after - r.before) * 10) / 10
          return (
            <li key={r.comp} className="grid grid-cols-[8rem_minmax(0,1fr)_11rem] items-center gap-4 text-sm">
              <span className="truncate">{r.comp}</span>
              <div className="space-y-0.5 border-l border-border-strong" aria-hidden>
                {bar(r.before, c.before, `${r.comp} before: ${r.before}%`)}
                {bar(r.after, c.after, `${r.comp} after: ${r.after}%`)}
              </div>
              <span className="text-right tabular-nums">
                <span className="text-muted">{r.before.toFixed(1)}%</span> → {r.after.toFixed(1)}% <span className="text-muted">({signed(d)}%)</span>
              </span>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">Bars start at 0%; scale to {max}%.</p>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted hover:text-text">View as table</summary>
        <div className="mt-2"><DataTable cols={['comp', 'before', 'after', 'change']} rows={rows.map((r) => [r.comp, `${r.before.toFixed(1)}%`, `${r.after.toFixed(1)}%`, `${signed(Math.round((r.after - r.before) * 10) / 10)}%`])} /></div>
      </details>
    </figure>
  )
}
