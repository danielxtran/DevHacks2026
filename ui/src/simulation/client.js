// Hexlab is the source of measured playtest data. This client never substitutes demo results.
export const SIMULATION_COUNTS = [100, 1000, 5000, 10000]
export const STAT_LABELS = {
  hp: 'Health',
  attackDamage: 'Attack damage',
  attackSpeed: 'Attack speed',
  armor: 'Armor',
  range: 'Range',
}
export const STAT_LIMITS = {
  hp: { min: 1, max: 10000, step: 1 },
  attackDamage: { min: 0, max: 1000, step: 1 },
  attackSpeed: { min: 0.1, max: 5, step: 0.1 },
  armor: { min: 0, max: 500, step: 1 },
  range: { min: 1, max: 4, step: 1 },
}

const API_BASE = (import.meta.env?.VITE_HEXLAB_API_URL || '/hexlab-api').replace(/\/+$/, '')
const COLLECTIONS = { unit: 'champions', item: 'items', monster: 'monsters' }
const ITEM_STATS = ['attackDamage', 'attackSpeed', 'armor']
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (object, key) => isRecord(object) && Object.hasOwn(object, key)
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const validId = (id) => typeof id === 'string' && /^[a-z][a-z0-9_]{0,49}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id)

function validConfig(config) {
  if (!isRecord(config) || typeof config.id !== 'string' || !config.id || typeof config.baselineConfigId !== 'string' || !config.baselineConfigId || typeof config.engineId !== 'string' || !/^[a-f0-9]{64}$/.test(config.engineId)) return false
  if (!isRecord(config.champions) || Object.keys(config.champions).length < 3 || !isRecord(config.items) || !own(config.monsters, 'krug')) return false
  return Object.entries(COLLECTIONS).every(([type, group]) => Object.entries(config[group]).every(([id, entry]) => {
    if (!validId(id) || !isRecord(entry) || typeof entry.name !== 'string' || !entry.name) return false
    return (type === 'item' ? ITEM_STATS : Object.keys(STAT_LIMITS)).every((stat) => {
      const min = type === 'item' ? 0 : STAT_LIMITS[stat].min
      return finite(entry[stat]) && entry[stat] >= min && entry[stat] <= STAT_LIMITS[stat].max && (stat !== 'range' || Number.isInteger(entry[stat]))
    })
  }))
}

/** Validate exactly what will be sent to Hexlab against the displayed baseline. */
export function validateSimulationPlan(plan, config) {
  const errors = []
  if (!isRecord(plan)) return { valid: false, errors: ['Add a simulation patch before sending this issue to Testing.'] }
  if (!validConfig(config)) return { valid: false, errors: ['Load the Hexlab baseline before configuring a simulation.'] }
  if (!plan.baselineConfigId || plan.baselineConfigId !== config.baselineConfigId) errors.push('The simulation baseline changed. Reload it and review the patch before testing.')
  if (!plan.engineId || plan.engineId !== config.engineId) errors.push('The Hexlab engine changed. Reload it and review the patch before testing.')
  if (!SIMULATION_COUNTS.includes(plan.simulations)) errors.push('Choose 100, 1,000, 5,000, or 10,000 battles per configuration.')
  if (!Number.isInteger(plan.seed) || plan.seed < 0 || plan.seed > 4294967295) errors.push('The seed must be an integer from 0 to 4,294,967,295.')
  if (!['pvp', 'pve'].includes(plan.mode)) errors.push('Choose PvP or PvE for the simulation.')
  if (!Array.isArray(plan.changes) || !plan.changes.length) errors.push('Add at least one stat change to test.')
  else if (plan.changes.length > 100) errors.push('A patch can contain at most 100 stat changes.')
  else {
    if (plan.mode === 'pvp' && plan.changes.some(change => change?.type === 'monster')) errors.push('Monster stats affect PvE battles. Switch to PvE to test changes against Krug.')
    const edits = new Set()
    let actualChange = false
    for (const [index, change] of plan.changes.entries()) {
      const label = `Change ${index + 1}`
      if (!isRecord(change) || !own(COLLECTIONS, change.type) || !validId(change.id)) {
        errors.push(`${label}: choose a supported unit, item, or monster.`)
        continue
      }
      if (Object.keys(change).some((key) => !['type', 'id', 'stat', 'value'].includes(key))) errors.push(`${label}: contains unsupported patch fields.`)
      const group = config[COLLECTIONS[change.type]]
      if (!own(group, change.id)) {
        errors.push(`${label}: the selected ${change.type} is not in this Hexlab baseline.`)
        continue
      }
      if (!own(STAT_LIMITS, change.stat) || (change.type === 'item' && !ITEM_STATS.includes(change.stat))) {
        errors.push(`${label}: select a supported numeric stat.`)
        continue
      }
      const key = `${change.type}:${change.id}:${change.stat}`
      if (edits.has(key)) errors.push(`${label}: this stat is already edited in the patch. Keep one value per stat.`)
      edits.add(key)
      const limits = STAT_LIMITS[change.stat]
      const min = change.type === 'item' ? 0 : limits.min
      if (!finite(change.value) || change.value < min || change.value > limits.max || (change.stat === 'range' && !Number.isInteger(change.value))) {
        errors.push(`${label}: ${STAT_LABELS[change.stat]} must be ${min}–${limits.max}${change.stat === 'range' ? ' (whole tiles)' : ''}.`)
      } else if (change.value !== group[change.id][change.stat]) actualChange = true
    }
    if (!actualChange && !errors.length) errors.push('The patch matches the baseline. Change at least one stat before testing.')
  }
  return { valid: errors.length === 0, errors }
}

async function requestJson(path, { signal, timeoutMs, ...options }) {
  const controller = new AbortController()
  let timedOut = false
  const cancel = () => controller.abort(signal.reason)
  if (signal?.aborted) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { Accept: 'application/json', ...options.headers },
      signal: controller.signal,
    })
    let data
    try { data = await response.json() } catch {
      throw new Error(response.ok ? 'Hexlab returned an unreadable response. Retry the simulation.' : `Hexlab returned HTTP ${response.status}. Check that its API is running on port 3002.`)
    }
    if (!response.ok) {
      if (response.status === 429) throw new Error('Hexlab is already running two evaluations. Wait for one to finish, then retry.')
      if (response.status === 400) throw new Error('Hexlab rejected the patch. Reload the baseline and check the IDs, numeric values, and battle count.')
      if (response.status === 413) throw new Error('The patch is too large. Reduce it to at most 100 stat changes.')
      if (response.status >= 500) throw new Error('Hexlab could not complete the evaluation. Check its API, then retry.')
      throw new Error(`Hexlab returned HTTP ${response.status}. The simulation did not complete.`)
    }
    return data
  } catch (error) {
    if (signal?.aborted) {
      const cancelled = new Error('Simulation cancelled.')
      cancelled.name = 'AbortError'
      throw cancelled
    }
    if (timedOut) throw new Error('Hexlab took too long to respond. Check its API and retry with fewer battles.')
    if (error instanceof TypeError) throw new Error('Cannot reach Hexlab. Start its API with npm run dev:api in tft-clone, then retry.')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

export async function fetchSimulationConfig({ signal } = {}) {
  const config = await requestJson('/config', { signal, timeoutMs: 10000 })
  if (!validConfig(config)) throw new Error('Hexlab returned an invalid baseline configuration. Check its API before testing.')
  return config
}

const metricValid = (metric) => isRecord(metric)
  && ['samples', 'wins', 'draws'].every((key) => Number.isInteger(metric[key]) && metric[key] >= 0)
  && metric.wins + metric.draws <= metric.samples
  && finite(metric.winRate) && metric.winRate >= 0 && metric.winRate <= 100
  && Array.isArray(metric.confidenceInterval) && metric.confidenceInterval.length === 2
  && metric.confidenceInterval.every((value) => finite(value) && value >= 0 && value <= 100)
  && metric.confidenceInterval[0] <= metric.confidenceInterval[1]
  && ['averageDamageDealt', 'averageDamageTaken', 'averageSurvivalDuration'].every((key) => finite(metric[key]) && metric[key] >= 0)

function batchValid(batch, request) {
  return isRecord(batch) && batch.games === request.simulations && Number.isInteger(batch.draws) && batch.draws >= 0 && batch.draws <= batch.games
    && ['champions', 'items', 'compositions'].every((group) => isRecord(batch[group]) && Object.values(batch[group]).every(metricValid))
    && (request.mode !== 'pve' || (finite(batch.clearRate) && batch.clearRate >= 0 && batch.clearRate <= 100))
}

const sameKeys = (before, after) => isRecord(before) && isRecord(after)
  && Object.keys(before).length === Object.keys(after).length && Object.keys(before).every((key) => own(after, key))

function comparisonMetricsValid(result, request) {
  if (!['champions', 'items', 'compositions'].every((group) => sameKeys(result.before[group], result.after[group]))) return false
  if (!Object.keys(result.before.champions).length) return false
  if (!request.changes.every((change) => change.type === 'monster' || own(result.before[change.type === 'unit' ? 'champions' : 'items'], change.id))) return false
  const metrics = ['winRate', 'averageDamageDealt', 'averageDamageTaken', 'averageSurvivalDuration']
  return ['champions', 'items'].every((group) => sameKeys(result.before[group], result.differences[group])
    && Object.keys(result.before[group]).every((id) => metrics.every((metric) => {
      const delta = result.differences[group][id]?.[metric]
      return finite(delta) && Math.abs(delta - (result.after[group][id][metric] - result.before[group][id][metric])) < 1e-8
    })))
    && (request.mode !== 'pve' || (finite(result.differences.clearRate)
      && Math.abs(result.differences.clearRate - (result.after.clearRate - result.before.clearRate)) < 1e-8))
}

/** Validate both network responses and saved evidence before accepting a human review. */
export function validateSimulationResult(result, request) {
  if (!isRecord(request) || typeof request.baselineConfigId !== 'string' || !request.baselineConfigId
    || typeof request.engineId !== 'string' || !request.engineId
    || !Array.isArray(request.changes) || !request.changes.length) {
    return { valid: false, errors: ['The simulation request is incomplete. Return to Development and prepare a numeric patch.'] }
  }
  if (result?.baselineConfigId !== request.baselineConfigId || result?.engineId !== request.engineId) {
    return { valid: false, errors: ['Hexlab evaluated a different baseline. Reload the baseline, review the patch, and test again.'] }
  }
  if (result.simulations !== request.simulations || result.seed !== request.seed || result.mode !== request.mode
    || !Array.isArray(result.appliedChanges) || result.appliedChanges.length !== request.changes.length
    || result.appliedChanges.some((change, index) => ['type', 'id', 'stat', 'value'].some((key) => change?.[key] !== request.changes[index]?.[key]))) {
    return { valid: false, errors: ['Hexlab returned results for a different patch or experiment. Retry before reviewing this issue.'] }
  }
  if (!batchValid(result.before, request) || !batchValid(result.after, request) || !isRecord(result.differences)
    || !comparisonMetricsValid(result, request)
    || typeof result.methodology !== 'string' || !finite(result.evaluationDurationMs) || result.evaluationDurationMs < 0) {
    return { valid: false, errors: ['Hexlab returned incomplete simulation results. Retry before reviewing this issue.'] }
  }
  return { valid: true, errors: [] }
}

/** Baseline and engine identities bind a browser request to the reviewed Hexlab implementation. */
export async function evaluatePatch(request, { signal } = {}) {
  if (!isRecord(request) || typeof request.baselineConfigId !== 'string' || !request.baselineConfigId || typeof request.engineId !== 'string' || !request.engineId) throw new Error('Reload the Hexlab baseline before testing this patch.')
  const body = { changes: request.changes, simulations: request.simulations, seed: request.seed, mode: request.mode,
    expectedBaselineConfigId: request.baselineConfigId, expectedEngineId: request.engineId }
  const result = await requestJson('/simulate', {
    method: 'POST', signal, timeoutMs: 135000,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const validation = validateSimulationResult(result, request)
  if (!validation.valid) throw new Error(validation.errors[0])
  return result
}
