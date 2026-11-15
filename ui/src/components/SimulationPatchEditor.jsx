import { useEffect, useId } from 'react'
import { SIMULATION_COUNTS, STAT_LABELS, STAT_LIMITS, validateSimulationPlan } from '../simulation/client.js'
import { Button } from './ui'

const TYPES = [
  ['unit', 'Champion', 'champions'],
  ['item', 'Item', 'items'],
  ['monster', 'Monster', 'monsters'],
]

const DEFAULT_PLAN = { changes: [], simulations: 1000, seed: 42, mode: 'pvp' }
const field = 'mt-1 block min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text disabled:cursor-not-allowed disabled:text-muted'

const choicesFor = (type) => type === 'item' ? ['attackDamage', 'attackSpeed', 'armor'] : Object.keys(STAT_LIMITS)
const collectionFor = (config, type) => config?.[TYPES.find(([id]) => id === type)?.[2]] ?? {}
const numberFromInput = (value) => value === '' ? '' : Number(value)

/** The executable experiment attached to a spec, independent of its prose. */
export default function SimulationPatchEditor({
  plan,
  onChange,
  config,
  loading = false,
  error,
  onReload,
  disabled = false,
  onValidityChange,
}) {
  const sectionId = useId()
  const current = { ...DEFAULT_PLAN, ...plan }
  const changes = Array.isArray(current.changes) ? current.changes : []
  const hasConfig = Boolean(config?.baselineConfigId && config.champions && config.items && config.monsters)
  const stale = Boolean(hasConfig && current.baselineConfigId && current.baselineConfigId !== config.baselineConfigId)
  const locked = disabled || loading || !hasConfig || stale
  const validation = hasConfig ? validateSimulationPlan(current, config) : { valid: false, errors: [] }
  const valid = validation.valid && !loading && !error && !stale
  const validationMessage = validation.errors.join('\n')

  useEffect(() => {
    onValidityChange?.({ valid, errors: validationMessage ? validationMessage.split('\n') : [] })
  }, [valid, validationMessage, onValidityChange])

  const update = (next) => {
    if (locked) return
    onChange({ ...current, ...next, baselineConfigId: config.baselineConfigId })
  }
  const updateRow = (index, next) => update({
    changes: changes.map((change, i) => i === index ? { ...change, ...next } : change),
  })

  return (
    <section aria-labelledby={`${sectionId}-heading`} className="space-y-5 border-t border-border pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose">
          <h2 id={`${sectionId}-heading`} className="font-display text-2xl font-bold">Simulation patch</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            These numeric changes are evaluated when you send this spec to Testing. Each new value replaces the baseline stat.
          </p>
        </div>
        {hasConfig && (
          <div className="flex max-w-full flex-wrap items-center gap-3">
            <span className="max-w-full break-all font-mono text-xs text-muted">Baseline: {config.baselineConfigId}</span>
            {onReload && <Button type="button" variant="ghost" disabled={loading} onClick={onReload}>Reload baseline</Button>}
          </div>
        )}
      </div>

      {loading && <p role="status" className="text-sm text-muted">Loading the simulator’s champions, items, and baseline stats…</p>}

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4">
          <p className="max-w-prose text-sm text-warning">{typeof error === 'string' ? error : error.message || 'The simulator configuration could not be loaded.'}</p>
          {onReload && <Button type="button" size="sm" disabled={loading} onClick={onReload}>Retry connection</Button>}
        </div>
      )}

      {!loading && !error && !hasConfig && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4">
          <p className="text-sm text-muted">Connect to the simulator to choose a target and inspect its baseline stats.</p>
          {onReload && <Button type="button" size="sm" onClick={onReload}>Load simulator</Button>}
        </div>
      )}

      {stale && (
        <div role="alert" className="space-y-3 rounded-lg bg-surface p-4">
          <p className="text-sm text-warning">
            The simulator baseline has changed since this patch was prepared. Keep these edits and review them against the current baseline before testing.
          </p>
          {!disabled && <Button type="button" size="sm" disabled={loading} onClick={() => onChange({ ...current, changes, baselineConfigId: config.baselineConfigId })}>Review against current baseline</Button>}
        </div>
      )}

      <fieldset disabled={locked} className="min-w-0 space-y-5">
        <legend className="sr-only">Numeric stat changes and simulation settings</legend>
        {changes.length ? (
          <ol className="divide-y divide-border">
            {changes.map((change, index) => {
              const collection = collectionFor(config, change.type)
              const knownTarget = Object.hasOwn(collection, change.id)
              const target = knownTarget ? collection[change.id] : undefined
              const stats = choicesFor(change.type)
              const limits = STAT_LIMITS[change.stat]
              const min = change.type === 'item' ? 0 : limits?.min
              const badValue = change.value === '' || typeof change.value !== 'number' || !Number.isFinite(change.value)
                || !limits || change.value < min || change.value > limits.max || (change.stat === 'range' && !Number.isInteger(change.value))
              const inputId = `${sectionId}-change-${index}`

              return (
                <li key={index} className="space-y-3 py-5 first:pt-0">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">Change {index + 1}</h3>
                    <Button type="button" variant="danger" disabled={locked} onClick={() => update({ changes: changes.filter((_, i) => i !== index) })} aria-label={`Remove change ${index + 1}`}>Remove</Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[0.8fr_1.2fr_1fr_1fr]">
                    <label className="block min-w-0 text-xs text-muted">
                      Target type
                      <select value={change.type} onChange={(event) => updateRow(index, { type: event.target.value, id: '', stat: 'attackDamage', value: '' })} className={field}>
                        {!TYPES.some(([type]) => type === change.type) && <option value={change.type}>Unsupported type</option>}
                        {TYPES.map(([type, label]) => <option key={type} value={type}>{label}</option>)}
                      </select>
                    </label>
                    <label className="block min-w-0 text-xs text-muted">
                      {TYPES.find(([type]) => type === change.type)?.[1] ?? 'Target'}
                      <select value={change.id} onChange={(event) => updateRow(index, { id: event.target.value, value: '' })} aria-invalid={!knownTarget} className={field}>
                        <option value="">Choose a target</option>
                        {change.id && !knownTarget && <option value={change.id}>Unavailable: {change.id}</option>}
                        {Object.entries(collection).map(([id, entry]) => <option key={id} value={id}>{entry.name}</option>)}
                      </select>
                    </label>
                    <label className="block min-w-0 text-xs text-muted">
                      Stat
                      <select value={change.stat} onChange={(event) => updateRow(index, { stat: event.target.value, value: '' })} aria-invalid={!stats.includes(change.stat)} className={field}>
                        {!stats.includes(change.stat) && <option value={change.stat}>Unsupported: {change.stat}</option>}
                        {stats.map((stat) => <option key={stat} value={stat}>{STAT_LABELS[stat]}</option>)}
                      </select>
                    </label>
                    <label className="block min-w-0 text-xs text-muted" htmlFor={inputId}>
                      New value
                      <input id={inputId} type="number" inputMode="decimal" value={change.value ?? ''} min={min} max={limits?.max} step={change.stat === 'range' ? 1 : 'any'} onChange={(event) => updateRow(index, { value: numberFromInput(event.target.value) })} aria-invalid={badValue} aria-describedby={`${inputId}-baseline`} className={`${field} tabular-nums`} />
                    </label>
                  </div>
                  <p id={`${inputId}-baseline`} className="text-xs leading-relaxed text-muted">
                    Baseline: <span className="font-mono text-text">{typeof target?.[change.stat] === 'number' ? target[change.stat] : 'Choose a target and stat'}</span>
                    {limits && <span> · Allowed: {min}–{limits.max}{change.stat === 'range' ? ', whole tiles' : change.stat === 'attackSpeed' ? ' attacks/second' : ''}</span>}
                  </p>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="rounded-lg bg-surface p-4 text-sm text-muted">No numeric changes attached. Add the exact stats this spec should test.</p>
        )}

        <Button type="button" size="sm" disabled={locked || changes.length >= 100} onClick={() => update({ changes: [...changes, { type: 'unit', id: '', stat: 'attackDamage', value: '' }] })}>Add stat change</Button>

        <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-3">
          <label className="block text-xs text-muted">
            Battles per configuration
            <select value={current.simulations} onChange={(event) => update({ simulations: Number(event.target.value) })} className={field}>
              {!SIMULATION_COUNTS.includes(current.simulations) && <option value={current.simulations}>Choose a supported count</option>}
              {SIMULATION_COUNTS.map((count) => <option key={count} value={count}>{count.toLocaleString()}</option>)}
            </select>
          </label>
          <label className="block text-xs text-muted">
            Random seed
            <input type="number" min={0} max={4294967295} step={1} value={current.seed ?? ''} onChange={(event) => update({ seed: numberFromInput(event.target.value) })} className={`${field} tabular-nums`} />
          </label>
          <label className="block text-xs text-muted">
            Battle mode
            <select value={current.mode} onChange={(event) => update({ mode: event.target.value })} className={field}>
              {!['pvp', 'pve'].includes(current.mode) && <option value={current.mode}>Choose a battle mode</option>}
              <option value="pvp">PvP · 3 versus 3</option>
              <option value="pve">PvE · against Krug</option>
            </select>
          </label>
        </div>
      </fieldset>

      <p className="max-w-prose text-xs leading-relaxed text-muted">
        Hexlab supports health, attack damage, attack speed, armor, and range. Spells, stuns, traits, and other prose-only changes cannot be simulated. Original and modified configurations use identical seeded matchups.
      </p>

      {hasConfig && !loading && !stale && validation.errors.length > 0 && (
        <div aria-live="polite" className="space-y-1 text-sm text-warning">
          <p className="font-semibold">Before sending to Testing:</p>
          <ul className="list-disc space-y-1 pl-5">
            {validation.errors.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}
