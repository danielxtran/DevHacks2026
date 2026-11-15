import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { createServer } from 'vite'

test('workflow copy and errors belong to the stage being viewed', async t => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
  t.after(() => vite.close())
  const [{ default: WorkflowPage }, { PipelineContext }] = await Promise.all([
    vite.ssrLoadModule('/src/pages/WorkflowPage.jsx'),
    vite.ssrLoadModule('/src/store/context.js'),
  ])
  const render = (mode, { phase = 'spec_queued', error = null, jobs = [], versions = [], simulations = [] } = {}) => {
    const run = { id: 'run-1', lifecycle_phase: phase, status: error ? 'failed' : 'queued', error }
    const issue = { id: 'issue-1', runs: [{ id: run.id }], backendRun: { id: run.id } }
    const state = { workflow: { run, jobs, versions, simulations }, capabilities: {} }
    return renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/issues/issue-1'] },
      h(PipelineContext.Provider, { value: { state, command: () => { throw new Error('Rendering must not send commands') } } },
        h(Routes, null, h(Route, { path: '/issues/:id', element: h(Outlet, { context: { issue } }) },
          h(Route, { index: true, element: h(WorkflowPage, { mode }) }))))))
  }
  const savedSpec = { id: 'spec-1', current: true, approved: true, version_number: 1, markdown: 'Saved spec', numeric_patch: [] }
  const simulation = { id: 'simulation-1', battles: 1000, seed: 42 }

  await t.test('queued and running specifications have distinct, non-error copy', () => {
    const queued = render('spec', { jobs: [{ kind: 'spec_initial', state: 'queued' }] })
    assert.match(queued, /Specification queued/)
    assert.match(queued, /Waiting for the Spec Writer to start/)
    assert.doesNotMatch(queued, /role="alert"|Writing specification/)
    for (const kind of ['spec_initial', 'spec_revision']) {
      const running = render('spec', { jobs: [{ kind, state: 'running' }] })
      assert.match(running, /Writing specification/)
      assert.match(running, /Testing starts only after you review and approve/)
      assert.doesNotMatch(running, /role="alert"|Waiting for the Spec Writer to start/)
    }
  })

  await t.test('a spec failure appears once in Development, not as a Testing error', () => {
    const bundle = { phase: 'spec_failed', error: 'Model timed out' }
    const development = render('spec', bundle)
    assert.match(development, /Specification could not be generated/)
    assert.equal(development.match(/Model timed out/g)?.length, 1)
    assert.equal(development.match(/role="alert"/g)?.length, 1)
    const testing = render('playtest', bundle)
    assert.match(testing, /Testing has not started/)
    assert.match(testing, /Review and approve the specification in Development/)
    assert.doesNotMatch(testing, /Model timed out|role="alert"|Specification failed/)
  })

  await t.test('a failed spec revision preserves its saved version and explains the failure', () => {
    const html = render('spec', { phase: 'spec_failed', error: 'Revision timed out', versions: [savedSpec] })
    assert.match(html, /Your saved version is still available below/)
    assert.equal(html.match(/Revision timed out/g)?.length, 1)
  })

  await t.test('queued retries do not redisplay old errors', () => {
    const development = render('spec', {
      error: 'Previous model error', jobs: [{ kind: 'spec_initial', state: 'queued', error: 'Previous job error' }],
    })
    assert.doesNotMatch(development, /Previous model error|Previous job error|role="alert"/)
    const testing = render('playtest', {
      phase: 'simulation_queued', error: 'Previous simulation error', simulations: [{ ...simulation, state: 'queued' }],
    })
    assert.doesNotMatch(testing, /Previous simulation error|role="alert"/)
  })

  await t.test('simulation queueing and execution describe what is actually happening', () => {
    const queued = render('playtest', { phase: 'simulation_queued', simulations: [{ ...simulation, state: 'queued' }] })
    assert.match(queued, /Simulation queued/)
    assert.match(queued, /Waiting for Hexlab to start. It will compare/)
    assert.doesNotMatch(queued, /Comparing 1,000|role="alert"/)
    const running = render('playtest', { phase: 'simulation_queued', simulations: [{ ...simulation, state: 'running' }] })
    assert.match(running, /Running Hexlab comparison/)
    assert.match(running, /Comparing 1,000 paired battles/)
    assert.doesNotMatch(running, /Waiting for Hexlab|role="alert"/)
  })

  await t.test('simulation errors are not repeated or shown as specification failures', () => {
    const bundle = {
      phase: 'failed', error: 'Hexlab unavailable', versions: [savedSpec],
      simulations: [{ ...simulation, state: 'failed', error: 'Hexlab unavailable' }],
    }
    const testing = render('playtest', bundle)
    assert.equal(testing.match(/Hexlab unavailable/g)?.length, 1)
    assert.match(testing, /role="alert"[^>]*>Simulation failed: Hexlab unavailable/)
    const development = render('spec', bundle)
    assert.match(development, /Specification approved/)
    assert.doesNotMatch(development, /Hexlab unavailable|Simulation failed|role="alert"/)
  })

  await t.test('a simulation failure without a saved request still exposes its error', () => {
    const html = render('playtest', { phase: 'failed', error: 'Simulation job interrupted' })
    assert.match(html, /Simulation could not complete/)
    assert.match(html, /Simulation job interrupted/)
    assert.equal(html.match(/role="alert"/g)?.length, 1)
  })

  await t.test('historical simulation errors stay separate from current spec errors', () => {
    const bundle = {
      phase: 'spec_failed', error: 'Current spec error',
      simulations: [{ ...simulation, state: 'interrupted', error: 'Earlier simulation error' }],
    }
    const testing = render('playtest', bundle)
    assert.match(testing, /Simulation interrupted: Earlier simulation error/)
    assert.doesNotMatch(testing, /Current spec error/)
    const development = render('spec', bundle)
    assert.match(development, /Current spec error/)
    assert.doesNotMatch(development, /Earlier simulation error/)
  })
})
