import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import type { ArtifactStore } from './artifact-store.js';
import { configIdentifier, type HexlabClient } from './hexlab.js';
import { WorkflowJobWorker } from './workflow-worker.js';

const runId = '11111111-1111-4111-8111-111111111111';
const parentId = '22222222-2222-4222-8222-222222222222';
const stats = { role: 'fighter', hp: 100, attackDamage: 10, attackSpeed: 1, armor: 10, range: 1 };
const config = {
  id: 'test', champions: { yasuo: { name: 'Yasuo', ...stats }, ahri: { name: 'Ahri', ...stats }, garen: { name: 'Garen', ...stats } },
  items: {}, monsters: { krug: { name: 'Krug', ...stats } },
};
const output = {
  markdown: 'Try reducing attack damage.', hypothesis: 'Lower damage may change outcomes.',
  evidenceAssessment: 'insufficient_evidence', evidenceRationale: 'Player feedback is not telemetry.',
  evidenceIds: ['feedback-1'], intendedChanges: ['Lower damage'], preservedBehavior: ['Targeting'],
  successCriteria: ['Compare paired outcomes'],
  numericPatch: [{ type: 'unit', id: 'yasuo', stat: 'attackDamage', value: 9 }], unsupportedReason: null,
};

for (const kind of ['spec_initial', 'spec_revision'] as const) {
  test(`${kind} saves only the operator prompt while retaining model context beyond 5000 characters`, async t => {
    const operatorPrompt = kind === 'spec_revision' ? 'x'.repeat(5000) : null;
    const evidence = { id: 'feedback-1', body: 'Long player feedback. '.repeat(400), source: 'reddit' };
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    let claimed = false;
    const query = async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      let rows: Record<string, unknown>[] = [];
      if (sql.includes('from public.workflow_jobs j join public.runs')) {
        if (!claimed) {
          claimed = true;
          rows = [{ id: 'job-1', run_id: runId, kind, generation: 0, attempt: 0, max_attempts: 2, revision: 1,
            input: kind === 'spec_revision' ? { parentVersionId: parentId, prompt: operatorPrompt } : {} }];
        }
      } else if (sql.includes("set state='running'")) rows = [{ id: 'job-1' }];
      else if (sql.includes('from public.runs r join public.issues')) rows = [{
        id: runId, issue_id: runId, lifecycle_phase: 'spec_queued', revision: 1, simulation_generation: 0,
        baseline_config: config, baseline_config_id: configIdentifier(config), engine_id: 'a'.repeat(64),
      }];
      else if (sql.includes('select payload from public.run_feedback_snapshots')) rows = [{ payload: evidence }];
      else if (sql.includes('select id,version_number,markdown')) rows = [{ id: parentId, version_number: 1, markdown: 'Original', numeric_patch: [] }];
      else if (sql.includes('select lifecycle_phase,revision')) rows = [{
        lifecycle_phase: 'spec_queued', revision: 1, simulation_generation: 0, current_spec_version_id: parentId,
      }];
      else if (sql.includes('select state,generation')) rows = [{ state: 'running', generation: 0 }];
      else if (sql.includes('insert into public.llm_calls')) rows = [{ id: '1' }];
      else if (sql.includes('insert into public.spec_versions')) {
        assert.equal(params[5], operatorPrompt);
        rows = [{ id: parentId, version_number: kind === 'spec_initial' ? 1 : 2 }];
      }
      return { rows, rowCount: rows.length };
    };
    const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
    const artifacts = { async save() { return { id: parentId }; } } as unknown as ArtifactStore;
    let modelContext = '';
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = await request.json() as { input: Array<{ content: string }> };
      modelContext = body.input[0]!.content;
      return new Response(JSON.stringify({
        id: 'resp_test', object: 'response', status: 'completed',
        output: [{ type: 'function_call', id: 'fc_test', call_id: 'call_test', status: 'completed',
          name: 'save_numeric_experiment_design', arguments: JSON.stringify(output) }],
      }), { headers: { 'Content-Type': 'application/json' } });
    });

    await new WorkflowJobWorker(pool, artifacts, 'test-key', 'test-model', {} as HexlabClient).processPending();
    assert.ok(modelContext.length > 5000);
    assert.equal(JSON.parse(modelContext).frozenPlayerEvidence[0].body, evidence.body);
    assert.equal(JSON.parse(modelContext).requestedChanges, operatorPrompt);
    assert.ok(calls.some(({ sql }) => sql.includes('insert into public.spec_versions')));
    assert.ok(calls.some(({ sql }) => sql.includes("lifecycle_phase='spec_review'")));
    assert.ok(!calls.some(({ sql }) => sql.includes("set state='failed'")));
  });
}
