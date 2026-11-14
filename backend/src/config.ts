import { resolve } from 'node:path';
import { ScenarioSchema } from './contracts.js';

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`Expected integer between ${min} and ${max}.`);
  return parsed;
}

function loopbackHost(value: string | undefined): string {
  const host = value ?? '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('The backend must bind to loopback only.');
  return host;
}

function scenarios(value: string | undefined) {
  if (!value) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('SCENARIO_MANIFEST must be valid JSON.'); }
  if (!Array.isArray(parsed)) throw new Error('SCENARIO_MANIFEST must be a JSON array.');
  return parsed.map((scenario) => ScenarioSchema.parse(scenario));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.SUPABASE_DB_URL ?? env.DATABASE_URL;
  const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
  if (!databaseUrl) throw new Error('SUPABASE_DB_URL is required for backend-only workflow writes.');
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required for source RPC access.');
  return {
    host: loopbackHost(env.API_HOST),
    port: int(env.API_PORT, 3001, 1, 65535),
    databaseUrl,
    supabaseUrl,
    supabaseAnonKey,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
    baselineRevision: env.BASELINE_REVISION,
    scenarios: scenarios(env.SCENARIO_MANIFEST),
    artifactDir: resolve(env.ARTIFACT_DIR ?? '.artifacts'),
    pollIntervalMs: int(env.POLL_INTERVAL_MS, 5000, 1000, 60000),
    maxCollectedItems: int(env.COLLECTOR_MAX_ITEMS, 500, 1, 5000),
  };
}
