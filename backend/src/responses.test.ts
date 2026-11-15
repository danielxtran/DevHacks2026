import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Pool } from 'pg';
import type { ArtifactStore } from './artifact-store.js';
import { DesignService } from './design.js';
import { DiscoveryAgent } from './discovery.js';

const issueId = '11111111-1111-4111-8111-111111111111';
const feedback = { id: 'r_post1', body: 'Stuns feel too long', source: 'r', title: null };
const group = {
  title: 'Long stuns', summary: 'A player reports long stuns.', category: 'feels_bad',
  target: null, targetType: null, feedbackIds: [feedback.id], existingIssueId: null, tags: ['combat'],
};
const design = {
  hypothesis: 'Shorter stuns may allow more actions.', evidenceAssessment: 'insufficient_evidence',
  evidenceRationale: 'Player claims are not measurements.', intendedChanges: ['Reduce stun duration'],
  preservedBehavior: ['Target selection'], successCriteria: ['More executed actions'],
  checks: [{ path: 'checks/stun.test.ts', contents: 'assert.ok(true);' }],
};
const scenarios = [1, 2, 3].map((seed) => ({ id: `scenario-${seed}`, seed, provenance: 'fixture', input: {} }));
const baseline = scenarios.map((scenario) => ({
  revision: 'baseline-revision', scenarioId: scenario.id, seed: scenario.seed, provenance: scenario.provenance,
  status: 'completed', metrics: { stunExposure: 2, executedActions: 10, durationMs: 5000, outcome: 'draw' }, trace: [],
}));

function database() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    let rows: Record<string, unknown>[] = [];
    if (sql.includes('select feedback_id from public.discovery_queue')) rows = [{ feedback_id: feedback.id }];
    else if (sql.includes('from public.feedback_posts where id')) rows = [feedback];
    else if (sql.includes('insert into public.discovered_issues')) rows = [{ id: issueId }];
    else if (sql.includes('from public.runs r join public.issues')) {
      rows = [{ baseline_revision: 'baseline-revision', scenario_manifest: scenarios, issue_id: issueId, target: null }];
    } else if (sql.includes('select payload from public.run_feedback_snapshots')) rows = [{ payload: feedback }];
    return { rows, rowCount: rows.length };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  return { pool, calls };
}

function artifacts() {
  const saved: Array<{ kind: string; contents: string }> = [];
  const store = {
    async save(_runId: string, kind: string, contents: string) {
      saved.push({ kind, contents });
      return { id: issueId };
    },
  } as unknown as ArtifactStore;
  return { store, saved };
}

function functionCall(name: string, args: unknown) {
  return { type: 'function_call', id: 'fc_test', call_id: 'call_test', name, arguments: JSON.stringify(args), status: 'completed' };
}

function mockResponses(t: TestContext, output: unknown[], status = 'completed', httpStatus = 200) {
  const requests: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, authorization: request.headers.get('authorization'), body: await request.json() });
    return new Response(JSON.stringify(httpStatus === 200 ? {
      id: 'resp_test', object: 'response', status, output, usage: { input_tokens: 100, output_tokens: 50 },
    } : { error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' } }), {
      status: httpStatus, headers: { 'content-type': 'application/json' },
    });
  });
  return requests;
}

function assertRequest(requests: ReturnType<typeof mockResponses>, name: string, limit: number) {
  assert.equal(requests.length, 1);
  const request = requests[0]!;
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.authorization, 'Bearer test-key');
  assert.equal(request.body.model, 'test-model');
  assert.equal(request.body.max_output_tokens, limit);
  assert.equal(request.body.store, false);
  assert.equal(request.body.parallel_tool_calls, false);
  assert.deepEqual(request.body.tool_choice, { type: 'function', name });
  const tools = request.body.tools as Array<{ type: string; name: string; strict: boolean }>;
  assert.equal(tools[0]?.type, 'function');
  assert.equal(tools[0]?.name, name);
  assert.equal(tools[0]?.strict, true);
  assert.match(String(request.body.instructions), /untrusted/);
  assert.match(JSON.stringify(request.body.input), /Stuns feel too long/);
}

test('Discovery uses Responses function calling and retains usage and supplied-evidence checks', async (t) => {
  const requests = mockResponses(t, [functionCall('save_discovery_groups', { groups: [group] })]);
  const db = database();
  await new DiscoveryAgent(db.pool, 'test-key', 'test-model').processPending();
  assertRequest(requests, 'save_discovery_groups', 4096);
  assert.ok(db.calls.some(({ sql }) => sql.includes('insert into public.discovered_issue_memberships')));
  assert.ok(db.calls.some(({ sql }) => sql.startsWith('delete from public.discovery_queue')));
  const log = db.calls.find(({ sql }) => sql.includes('insert into public.llm_calls'));
  assert.deepEqual(log?.params.slice(2, 5), [100, 50, true]);
});

for (const [label, output, status, httpStatus] of [
  ['unknown feedback', [functionCall('save_discovery_groups', { groups: [{ ...group, feedbackIds: ['unknown'] }] })], 'completed', 200],
  ['malformed JSON', [{ ...functionCall('save_discovery_groups', {}), arguments: '{' }], 'completed', 200],
  ['refusal', [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot comply' }] }], 'completed', 200],
  ['truncated response', [functionCall('save_discovery_groups', { groups: [group] })], 'incomplete', 200],
  ['authentication failure', [], 'failed', 401],
] as const) {
  test(`Discovery requeues ${label} without persisting groups`, async (t) => {
    mockResponses(t, [...output], status, httpStatus);
    const db = database();
    await new DiscoveryAgent(db.pool, 'test-key', 'test-model').processPending();
    assert.ok(db.calls.some(({ sql }) => sql.includes("set state = 'pending', last_error")));
    assert.ok(!db.calls.some(({ sql }) => sql.includes('insert into public.discovered_issues')));
    assert.ok(!db.calls.some(({ sql }) => sql.startsWith('delete from public.discovery_queue')));
    const log = db.calls.find(({ sql }) => sql.includes('insert into public.llm_calls'));
    assert.equal(log?.params[4], false);
  });
}

test('Discovery reports missing OpenAI configuration without a network call', async (t) => {
  const requests = mockResponses(t, []);
  const db = database();
  await new DiscoveryAgent(db.pool, undefined, undefined).processPending();
  assert.equal(requests.length, 0);
  const retry = db.calls.find(({ sql }) => sql.includes("set state = 'pending', last_error"));
  assert.match(String(retry?.params[1]), /OPENAI_API_KEY and OPENAI_MODEL/);
});

test('Design uses Responses function calling and saves validated design/check artifacts', async (t) => {
  const requests = mockResponses(t, [functionCall('save_experiment_design', design)]);
  const db = database();
  const files = artifacts();
  const result = await new DesignService(db.pool, files.store, 'test-key', 'test-model').designRun('run-test', baseline);
  assertRequest(requests, 'save_experiment_design', 6000);
  assert.deepEqual(result, { checks: ['checks/stun.test.ts'], materialized: false });
  assert.deepEqual(JSON.parse(files.saved.find(({ kind }) => kind === 'design')!.contents), design);
  assert.ok(files.saved.some(({ kind }) => kind === 'check'));
  assert.ok(db.calls.some(({ sql }) => sql.includes("workflow_stage='design_ready'")));
  const log = db.calls.find(({ sql }) => sql.includes('insert into public.llm_calls'));
  assert.deepEqual(log?.params.slice(3, 6), [100, 50, true]);
});

for (const [label, output, status] of [
  ['unsafe check paths', [functionCall('save_experiment_design', { ...design, checks: [{ path: '../escape.ts', contents: 'bad' }] })], 'completed'],
  ['invalid design', [functionCall('save_experiment_design', { ...design, checks: [] })], 'completed'],
  ['malformed JSON', [{ ...functionCall('save_experiment_design', {}), arguments: '{' }], 'completed'],
  ['missing function call', [], 'completed'],
  ['incomplete response', [functionCall('save_experiment_design', design)], 'incomplete'],
] as const) {
  test(`Design marks ${label} failed without saving design/check artifacts`, async (t) => {
    mockResponses(t, [...output], status);
    const db = database();
    const files = artifacts();
    await assert.rejects(new DesignService(db.pool, files.store, 'test-key', 'test-model').designRun('run-test', baseline));
    assert.ok(db.calls.some(({ sql }) => sql.includes("set status='failed',workflow_stage='design'")));
    assert.ok(!db.calls.some(({ sql }) => sql.includes('insert into public.specs')));
    assert.ok(!files.saved.some(({ kind }) => kind === 'design' || kind === 'check'));
    const log = db.calls.find(({ sql }) => sql.includes('insert into public.llm_calls'));
    assert.equal(log?.params[5], false);
  });
}
