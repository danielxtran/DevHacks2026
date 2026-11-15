import assert from 'node:assert/strict'
import test from 'node:test'
import { comparisonChartRows, formatDelta, hasSamples, patchRows, performanceRows, replayUrl, reviewBlockReason } from './results.js'

const playtest = () => ({
  source: 'hexlab',
  specV: 2,
  request: {
    baselineConfigId: 'saved-baseline', simulations: 100, seed: 42, mode: 'pvp',
    changes: [{ type: 'unit', id: 'yasuo', stat: 'attackDamage', value: 20 }],
  },
  configSnapshot: { baselineConfigId: 'saved-baseline', champions: { yasuo: { name: 'Yasuo', attackDamage: 25 } } },
  result: {
    baselineConfigId: 'saved-baseline',
    simulations: 100, seed: 42, mode: 'pvp',
    appliedChanges: [{ type: 'unit', id: 'yasuo', stat: 'attackDamage', value: 20 }],
    before: { champions: { yasuo: { samples: 85, winRate: 58 } } },
    after: { champions: { yasuo: { samples: 85, winRate: 49 } } },
  },
})
const issue = () => ({
  specVersions: [{ v: 1 }, { v: 2, spec: { simulation: playtest().request } }],
  approvals: { spec: { v: 2 } },
})

test('historical patch values come from the saved baseline and applied patch, not editable request values', () => {
  const saved = playtest()
  saved.request.changes = [{ type: 'unit', id: 'yasuo', stat: 'attackDamage', value: 5 }]
  const rows = patchRows(saved)
  assert.equal(rows[0].before, 25)
  assert.equal(rows[0].after, 20)
  assert.equal(rows[0].name, 'Yasuo')
})

test('rows retain actual per-entity samples and convert composition IDs to saved champion names', () => {
  const saved = playtest()
  saved.result.before.compositions = { 'yasuo + unknown': { samples: 2, winRate: 0 } }
  saved.result.after.compositions = { 'yasuo + unknown': { samples: 2, winRate: 50 } }
  assert.equal(performanceRows(saved, 'champions')[0].before.samples, 85)
  assert.equal(performanceRows(saved, 'champions')[0].modified, true)
  assert.equal(performanceRows(saved, 'compositions')[0].name, 'Yasuo + unknown')
  assert.equal(hasSamples({ samples: 0, winRate: 0 }), false)
})

test('percentage-point deltas use after minus before without rescaling rates', () => {
  assert.equal(formatDelta(58, 49, ' pp'), '-9.0 pp')
  assert.equal(formatDelta(49, 58, ' pp'), '+9.0 pp')
  assert.equal(formatDelta(20, 19.999, 's'), '0.0s')
  assert.equal(formatDelta(undefined, 10), '—')
})

test('chart points and asymmetric intervals use measured percentages without rescaling', () => {
  const saved = playtest()
  saved.result.before.champions.yasuo.confidenceInterval = [47, 68]
  saved.result.after.champions.yasuo.confidenceInterval = [38, 60]
  saved.result.before.champions.yasuo.averageDamageDealt = 140
  saved.result.after.champions.yasuo.averageDamageDealt = 120
  const chart = comparisonChartRows(saved, 'champions', 'winRate')
  assert.equal(chart.rows[0].beforeValue, 58)
  assert.equal(chart.rows[0].afterValue, 49)
  assert.deepEqual(chart.rows[0].beforeInterval, [11, 10])
  assert.deepEqual(chart.rows[0].afterInterval, [11, 11])
  assert.equal(chart.rows[0].beforeSamples, 85)
  const damage = comparisonChartRows(saved, 'champions', 'averageDamageDealt').rows[0]
  assert.equal(damage.beforeValue, 140)
  assert.equal(damage.afterValue, 120)
  assert.equal(Object.hasOwn(damage, 'beforeInterval'), false)
})

test('charts omit zero-sample entities and limit compositions by actual sample count', () => {
  const saved = playtest()
  saved.result.before.champions.unplayed = { samples: 0, winRate: 0 }
  saved.result.after.champions.unplayed = { samples: 0, winRate: 0 }
  assert.equal(comparisonChartRows(saved, 'champions', 'winRate').total, 1)
  saved.result.before.compositions = { 'yasuo + ahri': { samples: 2, winRate: 50 }, 'yasuo + garen': { samples: 8, winRate: 25 } }
  saved.result.after.compositions = { 'yasuo + ahri': { samples: 2, winRate: 50 }, 'yasuo + garen': { samples: 8, winRate: 75 } }
  const chart = comparisonChartRows(saved, 'compositions', 'winRate', 1)
  assert.equal(chart.total, 2)
  assert.equal(chart.rows.length, 1)
  assert.equal(chart.rows[0].id, 'yasuo + garen')
})

test('verification is blocked for demo, pending, failed, stale-spec and mismatched-baseline evidence', () => {
  assert.equal(reviewBlockReason(issue(), playtest()), null)
  assert.match(reviewBlockReason(issue(), { ...playtest(), source: 'demo' }), /illustrative/)
  assert.match(reviewBlockReason({ ...issue(), run: { id: 'pending' } }, playtest()), /finish/)
  assert.match(reviewBlockReason({ ...issue(), error: { title: 'Failed' } }, playtest()), /error/)
  assert.match(reviewBlockReason(issue(), { ...playtest(), specV: 1 }), /earlier spec/)
  const stale = playtest()
  stale.request.baselineConfigId = 'different-baseline'
  assert.match(reviewBlockReason(issue(), stale), /saved baseline/)
  const wrongPatch = playtest()
  wrongPatch.result.appliedChanges[0].value = 5
  assert.match(reviewBlockReason(issue(), wrongPatch), /requested patch/)
  const wrongSeed = playtest()
  wrongSeed.result.seed = 43
  assert.match(reviewBlockReason(issue(), wrongSeed), /settings/)
  assert.match(reviewBlockReason(issue(), playtest(), { baselineConfigId: 'new-baseline' }), /has changed/)
})

test('reruns can change battle count while preserving the approved patch, seed, mode, and baseline', () => {
  const approved = issue()
  const rerun = playtest()
  rerun.request.simulations = 5000
  rerun.result.simulations = 5000
  assert.equal(reviewBlockReason(approved, rerun), null)
  assert.equal(approved.specVersions[1].spec.simulation.simulations, 100)

  for (const field of ['seed', 'mode']) {
    const changed = playtest()
    changed.request[field] = field === 'seed' ? 43 : 'pve'
    changed.result[field] = changed.request[field]
    assert.match(reviewBlockReason(approved, changed), /approved patch/)
  }
  const changedPatch = playtest()
  changedPatch.request.changes[0].value = 10
  changedPatch.result.appliedChanges[0].value = 10
  assert.match(reviewBlockReason(approved, changedPatch), /approved patch/)
})

test('replayUrl links Hexlab to the exact evaluated experiment', () => {
  const url = new URL(replayUrl({ result: { baselineConfigId: 'mini-tft-v1-abc', simulations: 1000, seed: 42, mode: 'pvp',
    appliedChanges: [{ type: 'unit', id: 'yasuo', stat: 'attackDamage', value: 20 }] } }, 'http://hexlab.test'))
  assert.equal(url.origin, 'http://hexlab.test')
  assert.deepEqual(JSON.parse(url.searchParams.get('replay')), { baselineConfigId: 'mini-tft-v1-abc',
    changes: [{ type: 'unit', id: 'yasuo', stat: 'attackDamage', value: 20 }], simulations: 1000, seed: 42, mode: 'pvp' })
  assert.equal(url.searchParams.get('focus'), 'yasuo')
  assert.equal(replayUrl({ result: null }), null)
})
