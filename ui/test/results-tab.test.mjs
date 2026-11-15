import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createServer } from 'vite'

test('testing and closed experiments share one Results tab and retain history selections', async t => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
  t.after(() => vite.close())
  const [{ default: IssueLayout }, { default: WorkflowPage }, { PipelineContext }] = await Promise.all([
    vite.ssrLoadModule('/src/pages/IssueLayout.jsx'),
    vite.ssrLoadModule('/src/pages/WorkflowPage.jsx'),
    vite.ssrLoadModule('/src/store/context.js'),
  ])
  for (const stage of ['playtest', 'verified']) {
    const run = { id: 'run-1', lifecycle_phase: stage === 'verified' ? 'accepted' : 'simulation_review' }
    const issue = { id: 'issue-1', title: 'Test issue', mentions: 1, stage,
      status: stage === 'verified' ? 'done' : 'needs_review', backendRun: { id: run.id }, runs: [{ id: run.id }] }
    const state = { issues: [issue], workflow: { run, versions: [], jobs: [], simulations: [] } }
    const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/issues/issue-1/results?run=run-1&simulation=simulation-1'] },
      h(PipelineContext.Provider, { value: { state } },
        h(Routes, null, h(Route, { path: '/issues/:id', element: h(IssueLayout) },
          h(Route, { path: 'results', element: h(WorkflowPage, { mode: 'results' }) }))))))
    const nav = html.match(/<nav aria-label="Workflow stages"[^>]*>(.*?)<\/nav>/)?.[1]
    assert.ok(nav)
    assert.equal(nav.match(/<a /g)?.length, 3)
    assert.match(nav, /aria-current="step"[^>]*href="\/issues\/issue-1\/results\?run=run-1&amp;simulation=simulation-1"[^>]*>Results<\/a>/)
    assert.doesNotMatch(nav, />Testing<|>Closed</)
    assert.match(html, /<h2[^>]*>Results<\/h2>/)
    if (stage === 'verified') {
      assert.match(html, /Accepted/)
      assert.doesNotMatch(html, /Return to Development|Mark verified|Re-run/)
    }
  }
})
