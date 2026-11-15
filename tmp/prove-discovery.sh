#!/usr/bin/env bash
set -euo pipefail

# Run from any directory. Uses existing queued feedback; never starts the polling worker.
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root/backend"
printf '%s\n' 'Keep the backend worker stopped. This may make one billable OpenAI request and save discovered issues.'

exec node --env-file-if-exists=../.env --env-file-if-exists=.env --import tsx --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { loadConfig } from './src/config.ts';
import { DiscoveryAgent } from './src/discovery.ts';

const originalFetch = globalThis.fetch;
let pool;
let requests = 0;
let receipt;
let promptHash;
let groups = [];
let phase = 'configuration';

try {
  const config = loadConfig();
  assert(config.openaiApiKey && config.openaiModel, 'Set OPENAI_API_KEY and OPENAI_MODEL in backend/.env.');
  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 2,
    connectionTimeoutMillis: 8000,
    statement_timeout: 10000,
    application_name: 'discovery-one-shot',
  });

  phase = 'pending feedback';
  const pending = await pool.query(`
    select feedback_id from public.discovery_queue
    where state='pending' and next_attempt_at <= now()
    order by updated_at limit 30
  `);
  assert(pending.rowCount, 'No pending feedback; ingest source feedback before running this script. No model call made.');
  const before = await pool.query('select coalesce(max(id), 0)::text as id from public.llm_calls');
  console.log(`Processing up to ${pending.rowCount} queued feedback items with ${config.openaiModel}.`);

  globalThis.fetch = async (...args) => {
    assert.equal(requests, 0, 'Additional model request blocked; automatic network retries are disabled for this proof.');
    const request = new Request(...args);
    assert.equal(request.url, 'https://api.openai.com/v1/responses', 'Unexpected model endpoint.');
    const input = await request.clone().json();
    promptHash = createHash('sha256').update(input.input[0].content).digest('hex');
    requests++;
    const response = await originalFetch(...args);
    const body = await response.clone().json().catch(() => ({}));
    receipt = {
      httpStatus: response.status,
      requestId: response.headers.get('x-request-id'),
      responseId: body.id,
      model: body.model,
      status: body.status,
      usage: body.usage,
      errorCode: body.error?.code,
    };
    const call = body.output?.find(item => item.type === 'function_call' && item.name === 'save_discovery_groups');
    if (call) {
      try { groups = JSON.parse(call.arguments).groups ?? []; }
      catch { /* DiscoveryAgent reports invalid structured output. */ }
    }
    console.log(JSON.stringify({ receipt }, null, 2));
    return response;
  };

  phase = 'Discovery call';
  await new DiscoveryAgent(pool, config.openaiApiKey, config.openaiModel).processPending();
  assert.equal(requests, 1, 'No model request occurred.');
  assert.equal(receipt?.httpStatus, 200, 'OpenAI request failed; inspect the receipt.');
  assert.equal(receipt?.status, 'completed', 'Model response did not complete.');

  phase = 'persisted call verification';
  const logs = await pool.query(`
    select id, prompt_hash, ok, input_tokens, output_tokens, latency_ms
    from public.llm_calls where id > $1 and stage='discovery' and prompt_hash=$2
  `, [before.rows[0].id, promptHash]);
  console.log(JSON.stringify({ calls: logs.rows }, null, 2));
  assert.equal(logs.rowCount, 1, 'Expected one persisted call log matching this request.');
  assert.equal(logs.rows[0].ok, true, 'Discovery validation or persistence failed.');
  assert(groups.length > 0, 'Call completed but produced no issue groups; issue persistence is not proven.');

  phase = 'saved issue verification';
  for (const group of groups) {
    const fingerprint = createHash('sha256')
      .update(`${group.category}|${group.title.toLocaleLowerCase().trim()}|${group.target?.toLocaleLowerCase().trim() ?? ''}`)
      .digest('hex');
    const saved = await pool.query(`
      select i.id, i.title, m.feedback_id
      from public.discovered_issues i
      join public.discovered_issue_memberships m on m.issue_id=i.id
      where ($1::uuid is not null and i.id=$1 or $1::uuid is null and i.fingerprint=$2)
        and m.feedback_id = any($3::text[])
    `, [group.existingIssueId, fingerprint, group.feedbackIds]);
    assert.equal(new Set(saved.rows.map(row => row.feedback_id)).size, new Set(group.feedbackIds).size,
      'Not every returned feedback membership was saved.');
    console.log(JSON.stringify({ savedEvidence: saved.rows }, null, 2));
  }
  console.log('Discovery proof passed: real OpenAI response, matching call log, and saved issue memberships.');
} catch (error) {
  // Provider/database errors can include secrets; expose only our own assertions and error codes.
  const detail = error instanceof assert.AssertionError ? error.message : `Error code: ${error.code ?? 'unavailable'}`;
  console.error(`Proof incomplete during ${phase}. ${detail}`);
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  if (pool) await pool.end();
}
NODE
