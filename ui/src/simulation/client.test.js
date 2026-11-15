import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { evaluatePatch, fetchSimulationConfig, validateSimulationPlan, validateSimulationResult } from './client.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

const champion = { name: 'Yasuo', role: 'Duelist', hp: 115, attackDamage: 25, attackSpeed: 1.5, armor: 10, range: 1 }
const config = {
  id: 'mini-tft-v1', baselineConfigId: 'mini-tft-v1-example',
  champions: { yasuo: champion, garen: { ...champion, name: 'Garen' }, ahri: { ...champion, name: 'Ahri' } },
  items: { bf_sword: { name: 'B. F. Sword', attackDamage: 15, attackSpeed: 0, armor: 0 } },
  monsters: { krug: { ...champion, name: 'Krug' } },
}
const plan = {
  baselineConfigId: config.baselineConfigId, simulations: 1000, seed: 42, mode: 'pvp',
  changes: [{ type: 'unit', id: 'yasuo', stat: 'attackDamage', value: 20 }],
}
const metric = { samples: 100, wins: 50, draws: 0, winRate: 50, confidenceInterval: [40, 60], averageDamageDealt: 100, averageDamageTaken: 80, averageSurvivalDuration: 8 }
const batch = { games: 1000, draws: 0, champions: { yasuo: metric }, items: {}, compositions: {} }
const result = {
  baselineConfigId: config.baselineConfigId, simulations: 1000, seed: 42, mode: 'pvp', appliedChanges: plan.changes,
  before: batch, after: batch,
  differences: { champions: { yasuo: { winRate: 0, averageDamageDealt: 0, averageDamageTaken: 0, averageSurvivalDuration: 0 } }, items: {} },
  evaluationDurationMs: 25, methodology: 'Paired seeded battles.',
}
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data })

test('a reviewed numeric patch is valid without changing the baseline', () => {
  const saved = JSON.stringify(config)
  assert.deepEqual(validateSimulationPlan(plan, config), { valid: true, errors: [] })
  assert.equal(JSON.stringify(config), saved)
  assert.equal(validateSimulationPlan({ ...plan, changes: [{ type: 'item', id: 'bf_sword', stat: 'attackSpeed', value: 0.3 }] }, config).valid, true)
})

test('old or unsupported specs cannot silently become simulation patches', () => {
  for (const changes of [
    [],
    [{ type: 'unit', id: 'ironvane', stat: 'attackDamage', value: 20 }],
    [{ type: 'unit', id: 'yasuo', stat: 'stun_duration', value: 1 }],
    [{ type: 'item', id: 'bf_sword', stat: 'hp', value: 20 }],
    [{ type: 'unit', id: 'yasuo', stat: 'attackDamage', value: '20' }],
    [{ type: 'unit', id: 'yasuo', stat: 'hp', value: Infinity }],
    [{ type: 'unit', id: 'yasuo', stat: 'range', value: 1.5 }],
    [{ type: 'unit', id: 'yasuo', stat: 'attackDamage', value: 25 }],
    [...plan.changes, ...plan.changes],
  ]) assert.equal(validateSimulationPlan({ ...plan, changes }, config).valid, false, JSON.stringify(changes))
})

test('experiment validation rejects a stale baseline, unsupported count, invalid seed or missing mode', () => {
  for (const overrides of [
    { baselineConfigId: 'old-baseline' }, { simulations: 2000 }, { seed: -1 }, { seed: 4294967296 }, { seed: 1.5 }, { mode: undefined },
  ]) assert.equal(validateSimulationPlan({ ...plan, ...overrides }, config).valid, false)
  assert.equal(validateSimulationPlan(plan, null).valid, false)
})

test('monster stat patches require PvE so they affect the tested battles', () => {
  const monsterPlan = { ...plan, changes: [{ type: 'monster', id: 'krug', stat: 'hp', value: 300 }] }
  assert.equal(validateSimulationPlan(monsterPlan, config).valid, false)
  assert.equal(validateSimulationPlan({ ...monsterPlan, mode: 'pve' }, config).valid, true)
})

test('fetches the real baseline through the configured Hexlab proxy', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/hexlab-api/config')
    assert.equal(options.headers.Accept, 'application/json')
    return response(config)
  }
  assert.deepEqual(await fetchSimulationConfig(), config)
})

test('rejects an invalid baseline response', async () => {
  globalThis.fetch = async () => response({ champions: {} })
  await assert.rejects(fetchSimulationConfig(), /invalid baseline/)
})

test('submits the exact numeric patch and keeps baseline metadata out of the strict API body', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/hexlab-api/simulate')
    assert.equal(options.method, 'POST')
    assert.deepEqual(JSON.parse(options.body), { changes: plan.changes, simulations: 1000, seed: 42, mode: 'pvp' })
    return response(result)
  }
  assert.deepEqual(await evaluatePatch(plan), result)
})

test('refuses to attach results from another baseline, patch, seed or sample count', async () => {
  for (const overrides of [
    { baselineConfigId: 'another-baseline' }, { simulations: 5000 }, { seed: 123 },
    { appliedChanges: [{ ...plan.changes[0], value: 10 }] },
  ]) {
    globalThis.fetch = async () => response({ ...result, ...overrides })
    await assert.rejects(evaluatePatch(plan), /different baseline|different patch or experiment/)
  }
})

test('incomplete measured output is an error, never demo evidence', async () => {
  for (const overrides of [
    { after: { ...batch, champions: { yasuo: { ...metric, winRate: undefined } } } },
    { after: { ...batch, champions: {} } },
    { before: { ...batch, champions: {} }, after: { ...batch, champions: {} } },
    { differences: { champions: { yasuo: { winRate: 5 } }, items: {} } },
  ]) {
    globalThis.fetch = async () => response({ ...result, ...overrides })
    await assert.rejects(evaluatePatch(plan), /incomplete simulation results/)
  }
})

test('saved results must contain measured batches and match the frozen experiment', () => {
  assert.deepEqual(validateSimulationResult(structuredClone(result), structuredClone(plan)), { valid: true, errors: [] })
  for (const cached of [
    null,
    {},
    { ...result, before: {}, after: {}, differences: {} },
    { ...result, before: { ...batch, champions: {} }, after: { ...batch, champions: {} } },
    { ...result, after: { ...batch, games: 100 } },
    { ...result, after: { ...batch, champions: { yasuo: { ...metric, confidenceInterval: [70, 40] } } } },
    { ...result, seed: 999 },
  ]) assert.equal(validateSimulationResult(cached, plan).valid, false)
  assert.equal(validateSimulationResult(result, null).valid, false)
  assert.equal(validateSimulationResult(result, { ...plan, changes: null }).valid, false)
})

test('offline and busy services produce actionable errors', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  await assert.rejects(evaluatePatch(plan), /Cannot reach Hexlab.*dev:api/)
  globalThis.fetch = async () => response({ error: 'busy' }, 429)
  await assert.rejects(evaluatePatch(plan), /two evaluations.*retry/)
  globalThis.fetch = async () => response({ error: 'invalid' }, 400)
  await assert.rejects(evaluatePatch(plan), /rejected the patch/)
})

test('cancellation is distinct from an evaluation failure', async () => {
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })
  const controller = new AbortController()
  const pending = evaluatePatch(plan, { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError', message: 'Simulation cancelled.' })
})
