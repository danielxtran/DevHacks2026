import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchSimulationConfig, evaluatePatch } from './client.js'
import { makeSeed } from '../data/seed.js'
import { reducer, canVerifySimulation } from '../store/reducer.js'

const origin = process.env.HEXLAB_TEST_URL

test('Development approval produces real API evidence, reruns, and a reviewable Testing result', { skip: !origin }, async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (url, options) => originalFetch(new URL(url, origin), options)
  try {
    const config = await fetchSimulationConfig()
    const id = 'iss-hexlab-yasuo'
    const getIssue = state => state.issues.find(issue => issue.id === id)
    const plan = { baselineConfigId: config.baselineConfigId, changes: [{ type: 'unit', id: 'yasuo', stat: 'attackDamage',
      value: config.champions.yasuo.attackDamage === 20 ? 19 : 20 }], simulations: 100, seed: 42, mode: 'pvp' }
    let state = reducer(makeSeed(), { type: 'SPEC_APPROVE', id, plan, config, runId: 'integration-1' })
    assert.equal(getIssue(state).run.kind, 'simulation')
    const result = await evaluatePatch(getIssue(state).run.request)
    assert.equal(result.before.games, 100)
    assert.equal(result.after.games, 100)
    assert.notEqual(result.before.champions.yasuo.averageDamageDealt, result.after.champions.yasuo.averageDamageDealt)
    state = reducer(state, { type: 'SIMULATION_SUCCEEDED', id, runId: 'integration-1', result })
    assert.equal(canVerifySimulation(getIssue(state)), true)
    state = reducer(state, { type: 'PLAYTEST_RERUN', id, matches: 100, config, runId: 'integration-2' })
    const repeated = await evaluatePatch(getIssue(state).run.request)
    assert.deepEqual(repeated.before, result.before)
    assert.deepEqual(repeated.after, result.after)
    state = reducer(state, { type: 'SIMULATION_SUCCEEDED', id, runId: 'integration-2', result: repeated })
    assert.equal(getIssue(state).playtests.length, 2)
    state = reducer(state, { type: 'PLAYTEST_VERIFY', id, comment: 'Reviewed actual API evidence' })
    assert.equal(getIssue(state).stage, 'verified')
  } finally { globalThis.fetch = originalFetch }
})
