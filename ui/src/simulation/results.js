const GROUPS = { unit: 'champions', item: 'items', monster: 'monsters' }
const sameChanges = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && a.every((change, index) =>
    ['type', 'id', 'stat', 'value'].every((key) => change?.[key] === b[index]?.[key]))

export const STAT_LABELS = {
  hp: 'Health',
  attackDamage: 'Attack damage',
  attackSpeed: 'Attack speed',
  armor: 'Armor',
  range: 'Range',
}

export function configName(config, type, id) {
  return config?.[GROUPS[type]]?.[id]?.name ?? id
}

/** History always uses the baseline and validated patch saved with that result. */
export function patchRows(playtest) {
  const config = playtest.configSnapshot
  return (playtest.result?.appliedChanges ?? []).map((change) => ({
    ...change,
    name: configName(config, change.type, change.id),
    label: STAT_LABELS[change.stat] ?? change.stat,
    before: config?.[GROUPS[change.type]]?.[change.id]?.[change.stat],
    after: change.value,
  }))
}

export function performanceRows(playtest, group) {
  const before = playtest.result?.before?.[group] ?? {}
  const after = playtest.result?.after?.[group] ?? {}
  const modified = new Set((playtest.result?.appliedChanges ?? [])
    .filter((change) => GROUPS[change.type] === group)
    .map((change) => change.id))
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].map((id) => ({
    id,
    name: group === 'compositions'
      ? id.split(' + ').map((unit) => configName(playtest.configSnapshot, 'unit', unit)).join(' + ')
      : configName(playtest.configSnapshot, group === 'items' ? 'item' : 'unit', id),
    modified: modified.has(id),
    before: before[id],
    after: after[id],
  })).sort((a, b) => Number(b.modified) - Number(a.modified)
    || (group === 'compositions' ? (b.after?.samples ?? 0) - (a.after?.samples ?? 0) : 0)
    || a.name.localeCompare(b.name))
}

export function formatMetric(value, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'
}

export function formatDelta(before, after, suffix = '') {
  if (![before, after].every((value) => typeof value === 'number' && Number.isFinite(value))) return '—'
  // Avoid displaying a negative zero when the rendered values are unchanged.
  const delta = Number((after - before).toFixed(1))
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}${suffix}`
}

export function hasSamples(metric) {
  return Number.isInteger(metric?.samples) && metric.samples > 0
}

/** Project measured entity metrics into paired bars; never synthesize intermediate battles. */
export function comparisonChartRows(playtest, group, metric, limit = Infinity) {
  const eligible = performanceRows(playtest, group).filter(row => hasSamples(row.before) && hasSamples(row.after)
    && Number.isFinite(row.before[metric]) && Number.isFinite(row.after[metric]))
  const interval = value => Array.isArray(value.confidenceInterval) && value.confidenceInterval.length === 2
    ? [Math.max(0, value.winRate - value.confidenceInterval[0]), Math.max(0, value.confidenceInterval[1] - value.winRate)]
    : undefined
  return {
    total: eligible.length,
    rows: eligible.slice(0, limit).map(row => ({
      id: row.id, name: row.name, modified: row.modified,
      beforeValue: row.before[metric], afterValue: row.after[metric],
      beforeSamples: row.before.samples, afterSamples: row.after.samples,
      ...(metric === 'winRate' ? { beforeInterval: interval(row.before), afterInterval: interval(row.after) } : {}),
    })),
  }
}

/** An older/demo/failed run must never enable a real verification action. */
export function reviewBlockReason(issue, playtest, config) {
  if (playtest?.source !== 'hexlab') return 'This is illustrative demo data. Return to Development and run a real simulation.'
  if (!playtest.result?.before || !playtest.result?.after) return 'The simulation result is incomplete. Run the comparison again.'
  if (issue.run) return 'Wait for the current simulation to finish.'
  if (issue.error) return 'Resolve the simulation error before verifying.'
  const latestVersion = issue.specVersions?.at(-1)?.v ?? issue.specVersions?.length
  if (playtest.specV !== issue.approvals?.spec?.v || playtest.specV !== latestVersion) {
    return 'These results belong to an earlier spec. Test the latest approved version.'
  }
  if (!playtest.request?.baselineConfigId || playtest.request.baselineConfigId !== playtest.result.baselineConfigId
    || playtest.configSnapshot?.baselineConfigId !== playtest.result.baselineConfigId
    || !playtest.request.engineId || playtest.request.engineId !== playtest.result.engineId
    || playtest.configSnapshot?.engineId !== playtest.result.engineId) {
    return 'The result does not match its saved baseline. Return to Development and run a new comparison.'
  }
  const request = playtest.request
  const result = playtest.result
  if (result.simulations !== request.simulations || result.seed !== request.seed || result.mode !== request.mode
    || !sameChanges(result.appliedChanges, request.changes)) {
    return 'The result does not match the requested patch and settings. Run the comparison again.'
  }
  const approvedPlan = issue.specVersions?.[issue.approvals.spec.v - 1]?.spec?.simulation
  // A rerun may increase the sample count without changing the approved patch.
  if (!approvedPlan || request.baselineConfigId !== approvedPlan.baselineConfigId
    || request.seed !== approvedPlan.seed || request.mode !== approvedPlan.mode
    || !sameChanges(request.changes, approvedPlan.changes)) {
    return 'These results do not match the approved patch. Return to Development and test the approved changes.'
  }
  if (config?.baselineConfigId && config.baselineConfigId !== playtest.result.baselineConfigId) {
    return 'The simulator baseline has changed. Return to Development to prepare a new comparison.'
  }
  return null
}

const HEXLAB_APP_URL = (import.meta.env?.VITE_HEXLAB_APP_URL || 'http://127.0.0.1:5176').replace(/\/+$/, '')

/** Deep link into Hexlab's replay view for the exact experiment behind this result. */
export function replayUrl(playtest, baseUrl = HEXLAB_APP_URL) {
  const result = playtest?.result
  if (!result?.baselineConfigId || !result.engineId || !Array.isArray(result.appliedChanges)) return null
  const experiment = {
    baselineConfigId: result.baselineConfigId, engineId: result.engineId,
    changes: result.appliedChanges.map(({ type, id, stat, value }) => ({ type, id, stat, value })),
    simulations: result.simulations, seed: result.seed, mode: result.mode,
  }
  const focus = result.appliedChanges.find(change => change.type === 'unit')?.id
  return `${baseUrl}/?replay=${encodeURIComponent(JSON.stringify(experiment))}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}`
}
