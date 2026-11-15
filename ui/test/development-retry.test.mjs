import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { createServer } from 'vite'

test('failed development shows retry controls on the issue and Development screens', async t => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
  t.after(() => vite.close())
  const [{ default: IssueDetail }, { default: WorkflowPage }, { PipelineContext }] = await Promise.all([
    vite.ssrLoadModule('/src/pages/IssueDetail.jsx'),
    vite.ssrLoadModule('/src/pages/WorkflowPage.jsx'),
    vite.ssrLoadModule('/src/store/context.js'),
  ])
  const issueId = '11111111-1111-4111-8111-111111111111'
  const run = {
    id: '22222222-2222-4222-8222-222222222222', revision: 2,
    lifecycle_phase: 'spec_failed', status: 'failed', error: 'Model timed out',
    capabilities: { retrySpec: { enabled: true, reason: null } },
  }
  const issue = {
    id: issueId, title: 'Test issue', summary: 'Test evidence', feedback: [], tags: [],
    sources: { reddit: 0, x: 0 }, mentions: 0,
    triageState: 'open', stage: 'spec', backendRun: { id: run.id },
    runs: [{ id: run.id }],
  }
  const state = { issues: [issue], sourceStatus: {}, capabilities: {}, workflow: { run, versions: [], jobs: [], simulations: [] } }
  const render = page => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [`/issues/${issueId}`] },
    h(PipelineContext.Provider, { value: { state, command: () => { throw new Error('Rendering must not retry automatically') } } },
      h(Routes, null, h(Route, { path: '/issues/:id', element: h(Outlet, { context: { issue } }) },
        h(Route, { index: true, element: page }))))))

  for (const page of [h(IssueDetail), h(WorkflowPage, { mode: 'spec' })]) {
    const html = render(page)
    assert.match(html, /<button\b[^>]*>Retry development<\/button>/)
    assert.doesNotMatch(html, /gameplay telemetry/i)
    assert.doesNotMatch(html, /<button\b[^>]*\sdisabled(?=[\s=>])[^>]*>Retry development<\/button>/)
  }
  run.capabilities.retrySpec = { enabled: false, reason: 'The Spec Writer reached its three-attempt limit.' }
  assert.match(render(h(WorkflowPage, { mode: 'spec' })), /<button\b[^>]*\sdisabled(?=[\s=>])[^>]*>Retry development<\/button>/)
  assert.match(render(h(IssueDetail)), /three-attempt limit/)
  run.lifecycle_phase = 'spec_queued'
  run.status = 'queued'
  assert.doesNotMatch(render(h(IssueDetail)), /Retry development/)
  assert.doesNotMatch(render(h(WorkflowPage, { mode: 'spec' })), /Retry development/)
  state.workflow = null
  issue.backendRun = null
  issue.stage = 'feedback'
  assert.doesNotMatch(render(h(IssueDetail)), /Retry development/)
})
