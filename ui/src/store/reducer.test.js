import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeSeed } from '../data/seed.js'
import { reducer, canVerifySimulation } from './reducer.js'
import { restorePipelineState } from './restore.js'
import { reviseSpec } from '../data/generators.js'

const config = {
  id: 'mini-tft-v1', baselineConfigId: 'test-baseline',
  ...Object.fromEntries(['champions', 'items', 'monsters'].map(name => [name,
    JSON.parse(readFileSync(new URL(`../../../tft-clone/src/config/${name}.json`, import.meta.url)))])),
}
const id = 'iss-hexlab-yasuo'
const issue = state => state.issues.find(row => row.id === id)
const plan = { changes: [{ type: 'unit', id: 'yasuo', stat: 'attackDamage', value: 20 }],
  simulations: 100, seed: 42, mode: 'pvp', baselineConfigId: config.baselineConfigId }
const start = (state = makeSeed(), patch = plan, runId = 'run-1') => reducer(state,
  { type: 'SPEC_APPROVE', id, plan: patch, config, runId })
const resultFor = run => {
  const metric = { samples: 100, wins: 50, draws: 0, winRate: 50, confidenceInterval: [40, 60],
    averageDamageDealt: 100, averageDamageTaken: 100, averageSurvivalDuration: 5 }
  const batch = { games: run.request.simulations, draws: 0, champions: { yasuo: metric }, items: {}, compositions: {} }
  return { baselineConfigId: run.request.baselineConfigId,
    simulations: run.request.simulations, seed: run.request.seed, mode: run.request.mode,
    appliedChanges: structuredClone(run.request.changes), before: structuredClone(batch), after: structuredClone(batch),
    differences: { champions: { yasuo: { winRate: 0, averageDamageDealt: 0, averageDamageTaken: 0, averageSurvivalDuration: 0 } }, items: {} },
    methodology: 'Test fixture with complete metric fields.', evaluationDurationMs: 1 }
}
const finish = state => reducer(state, { type: 'SIMULATION_SUCCEEDED', id,
  runId: issue(state).run.id, result: resultFor(issue(state).run) })

test('Development approval freezes the exact patch, starts real work, and ignores demo failure controls', () => {
  const original = makeSeed()
  original.demo.failNext = true
  const draft = structuredClone(plan)
  const state = start(original, draft)
  assert.equal(issue(state).stage, 'playtest')
  assert.equal(issue(state).run.kind, 'simulation')
  assert.equal(issue(state).build, null)
  assert.equal(issue(state).playtest, null)
  assert.equal(issue(state).run.willFail, false)
  assert.equal(issue(state).approvals.spec.v, issue(state).specVersions.length)
  draft.changes[0].value = 99
  assert.equal(issue(state).run.request.changes[0].value, 20)
  assert.equal(canVerifySimulation(issue(state)), false)
  const ticked = reducer(state, { type: 'TICK' })
  assert.deepEqual(issue(ticked).run, issue(state).run)
  assert.equal(issue(ticked).playtest, null)
})

test('unsupported patches, missing config, stale baselines, and duplicate approvals never launch', () => {
  for (const invalid of [
    { ...plan, changes: [] },
    { ...plan, changes: [{ type: 'unit', id: 'ironvane', stat: 'stun', value: 1 }] },
    { ...plan, baselineConfigId: 'outdated' },
    { ...plan, simulations: 2000 },
  ]) assert.equal(issue(start(makeSeed(), invalid)).stage, 'spec')
  const initial = makeSeed()
  assert.equal(issue(reducer(initial, { type: 'SPEC_APPROVE', id, plan })).stage, 'spec')
  const running = start()
  assert.deepEqual(issue(start(running, plan, 'duplicate')).run, issue(running).run)
})

test('numeric edits and spec rewrites preserve the explicit supported patch and its settings', () => {
  const state = makeSeed()
  const spec = { ...issue(state).specVersions[0].spec, simulation: structuredClone(plan) }
  const edited = reducer(state, { type: 'SPEC_EDIT', id, spec: { ...spec, param: { ...spec.param, after: 22 } } })
  const latest = issue(edited).specVersions.at(-1).spec
  assert.equal(latest.simulation.changes[0].value, 22)
  const revised = reviseSpec(issue(edited), latest, 'Make this a smaller nerf').spec
  assert.equal(revised.simulation.changes[0].value, 23.5)
  assert.equal(revised.simulation.seed, plan.seed)
  assert.equal(revised.simulation.baselineConfigId, plan.baselineConfigId)
  assert.equal(revised.metrics.some(line => line.includes('currently')), false)
  const pending = start()
  assert.equal(issue(reducer(pending, { type: 'SPEC_EDIT', id, spec })).specVersions.length, issue(pending).specVersions.length)
  assert.equal(issue(reducer(pending, { type: 'SPEC_CHAT', id, text: 'Change it' })).run.id, issue(pending).run.id)
})

test('saving or approving simulation settings preserves independently edited spec markdown', () => {
  const state = makeSeed()
  issue(state).specVersions[0].markdown = '# Reviewer-written spec\nKeep this exact prose.'
  const next = reducer(state, { type: 'SPEC_EDIT', id, spec: { ...issue(state).specVersions[0].spec, simulation: plan }, preserveMarkdown: true })
  assert.equal(issue(next).specVersions.at(-1).markdown, issue(state).specVersions[0].markdown)
  assert.equal(issue(start(state)).specVersions.at(-1).markdown, issue(state).specVersions[0].markdown)
})

test('only the current request can attach results, and completion is idempotent', () => {
  const pending = start()
  const wrongId = reducer(pending, { type: 'SIMULATION_SUCCEEDED', id, runId: 'obsolete', result: resultFor(issue(pending).run) })
  assert.equal(issue(wrongId).playtest, null)
  const mismatched = resultFor(issue(pending).run)
  mismatched.appliedChanges[0].value = 10
  assert.equal(issue(reducer(pending, { type: 'SIMULATION_SUCCEEDED', id, runId: 'run-1', result: mismatched })).playtest, null)
  const completed = finish(pending)
  assert.equal(issue(completed).playtest.source, 'hexlab')
  assert.equal(issue(completed).playtests.length, 1)
  assert.equal(canVerifySimulation(issue(completed)), true)
  const duplicate = reducer(completed, { type: 'SIMULATION_SUCCEEDED', id, runId: 'run-1', result: resultFor(issue(pending).run) })
  assert.equal(issue(duplicate).playtests.length, 1)
})

test('reruns retain patch and seed, allow supported counts, and keep approved specs immutable', () => {
  const completed = finish(start())
  const before = structuredClone(issue(completed).specVersions)
  const rerunning = reducer(completed, { type: 'PLAYTEST_RERUN', id, matches: 1000, config, runId: 'run-2' })
  assert.equal(issue(rerunning).run.request.simulations, 1000)
  assert.equal(issue(rerunning).run.request.seed, plan.seed)
  assert.deepEqual(issue(rerunning).run.request.changes, plan.changes)
  assert.deepEqual(issue(rerunning).specVersions, before)
  assert.equal(canVerifySimulation(issue(rerunning)), false)
  const completeAgain = finish(rerunning)
  assert.equal(issue(completeAgain).playtests.length, 2)
  assert.equal(canVerifySimulation(issue(completeAgain)), true)
  assert.equal(issue(reducer(completed, { type: 'PLAYTEST_RERUN', id, matches: 2000, config })).run, null)
})

test('a failed rerun blocks old-result verification and retry uses a fresh run identity', () => {
  const completed = finish(start())
  const rerunning = reducer(completed, { type: 'PLAYTEST_RERUN', id, matches: 1000, config, runId: 'run-2' })
  const failed = reducer(rerunning, { type: 'SIMULATION_FAILED', id, runId: 'run-2', message: 'API unavailable' })
  assert.equal(issue(failed).playtests.length, 1)
  assert.equal(canVerifySimulation(issue(failed)), false)
  assert.equal(issue(reducer(failed, { type: 'PLAYTEST_VERIFY', id })).stage, 'playtest')
  const retried = reducer(failed, { type: 'RETRY_RUN', id, config, runId: 'run-3' })
  assert.equal(issue(retried).run.id, 'run-3')
  assert.equal(issue(retried).run.request.simulations, 1000)
  const stale = reducer(retried, { type: 'SIMULATION_FAILED', id, runId: 'run-2', message: 'Late failure' })
  assert.equal(issue(stale).error, null)
  assert.equal(canVerifySimulation(issue(finish(retried))), true)
})

test('returning to Development discards pending completion but retains history for review', () => {
  const completed = finish(start())
  const pending = reducer(completed, { type: 'PLAYTEST_RERUN', id, matches: 1000, config, runId: 'run-2' })
  const rejected = reducer(pending, { type: 'PLAYTEST_REJECT', id, comment: 'Try a smaller nerf' })
  const late = reducer(rejected, { type: 'SIMULATION_SUCCEEDED', id, runId: 'run-2', result: resultFor(issue(pending).run) })
  assert.equal(issue(late).stage, 'spec')
  assert.equal(issue(late).playtest, null)
  assert.equal(issue(late).playtests.length, 1)
  assert.equal(issue(late).playtests[0].outcome, 'rejected')
  assert.equal(canVerifySimulation(issue(late)), false)
})

test('verification accepts only completed current-spec real evidence and records the human decision', () => {
  const completed = finish(start())
  const verified = reducer(completed, { type: 'PLAYTEST_VERIFY', id, comment: 'Reviewed measured deltas' })
  assert.equal(issue(verified).stage, 'verified')
  assert.equal(issue(verified).playtests[0].outcome, 'verified')
  assert.equal(issue(verified).approvals.playtest.comment, 'Reviewed measured deltas')
  const invalid = structuredClone(completed)
  issue(invalid).playtest.specV += 1
  assert.equal(issue(reducer(invalid, { type: 'PLAYTEST_VERIFY', id })).stage, 'playtest')
  const legacy = makeSeed()
  const demoId = legacy.issues.find(i => i.playtest && i.stage === 'playtest').id
  assert.equal(reducer(legacy, { type: 'PLAYTEST_VERIFY', id: demoId }).issues.find(i => i.id === demoId).stage, 'playtest')
})

test('reload preserves completed results and turns unfinished requests into explicit retryable errors', () => {
  const pending = start()
  const restored = restorePipelineState(JSON.parse(JSON.stringify(pending)))
  assert.equal(issue(restored).run, null)
  assert.equal(issue(restored).status, 'error')
  assert.equal(issue(restored).error.run.id, 'run-1')
  const completed = finish(start())
  assert.deepEqual(issue(restorePipelineState(JSON.parse(JSON.stringify(completed)))).playtest, issue(completed).playtest)
  const oldState = makeSeed()
  oldState.issues = oldState.issues.filter(i => i.id !== id)
  assert.equal(restorePipelineState(oldState).issues.filter(i => i.id === id).length, 1)
  const corrupt = structuredClone(completed)
  issue(corrupt).playtest.result.before = {}
  assert.equal(issue(restorePipelineState(corrupt)).status, 'error')
  assert.equal(canVerifySimulation(issue(restorePipelineState(corrupt))), false)
})
