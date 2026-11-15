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

function sourceBaseUrl(value: string | undefined, fallback: string, name: string): string {
  const configured = value ?? fallback;
  let url: URL;
  try { url = new URL(configured); } catch { throw new Error(`${name} must be a valid HTTP(S) URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must use HTTP(S) and must not contain credentials.`);
  }
  return configured;
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
  if (!databaseUrl) throw new Error('SUPABASE_DB_URL is required for backend-only workflow writes.');
  return {
    host: loopbackHost(env.API_HOST),
    port: int(env.API_PORT, 3001, 1, 65535),
    databaseUrl,
    riotditBaseUrl: sourceBaseUrl(env.RIOTDIT_BASE_URL, 'http://127.0.0.1:5174', 'RIOTDIT_BASE_URL'),
    rBaseUrl: sourceBaseUrl(env.R_BASE_URL, 'http://127.0.0.1:5175', 'R_BASE_URL'),
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
    baselineRevision: env.BASELINE_REVISION,
    scenarios: scenarios(env.SCENARIO_MANIFEST),
    artifactDir: resolve(env.ARTIFACT_DIR ?? '.artifacts'),
    pollIntervalMs: int(env.POLL_INTERVAL_MS, 5000, 1000, 60000),
    maxCollectedItems: int(env.COLLECTOR_MAX_ITEMS, 500, 1, 5000),
  };
}
