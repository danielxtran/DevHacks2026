import { HexlabConfigSchema, NumericPatchSchema, type NumericChangeSchema } from './contracts.js';
import type { z } from 'zod';

export type HexlabConfig = z.infer<typeof HexlabConfigSchema>;
export type NumericChange = z.infer<typeof NumericChangeSchema>;
export interface SimulationInput {
  baselineConfigId: string;
  engineId: string;
  numericPatch: NumericChange[];
  seed: number;
  mode: 'pvp' | 'pve';
  battles: 100 | 1000 | 5000 | 10000;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function canonical(value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function configIdentifier(config: { id: string; champions: unknown; items: unknown; monsters: unknown }): string {
  const serialized = canonical(config);
  let hash = 2166136261;
  for (const char of serialized) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `${config.id}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function validateHexlabConfig(input: unknown): HexlabConfig {
  const config = HexlabConfigSchema.parse(input);
  if (configIdentifier({ id: config.id, champions: config.champions, items: config.items, monsters: config.monsters }) !== config.baselineConfigId) {
    throw new Error('Hexlab baseline identity does not match its configuration.');
  }
  return config;
}

export function canonicalNumericPatch(input: unknown, config: HexlabConfig, mode: 'pvp' | 'pve'): NumericChange[] {
  const changes = NumericPatchSchema.parse(input);
  if (!changes.length) throw new Error('numeric_patch_required');
  const seen = new Set<string>();
  let changed = false;
  for (const change of changes) {
    if (mode === 'pvp' && change.type === 'monster') throw new Error('monster_patch_requires_pve');
    const group = change.type === 'unit' ? config.champions : change.type === 'item' ? config.items : config.monsters;
    if (!Object.hasOwn(group, change.id)) throw new Error(`unknown_${change.type}_id`);
    if (change.type === 'item' && !['attackDamage', 'attackSpeed', 'armor'].includes(change.stat)) throw new Error('unsupported_item_stat');
    const key = `${change.type}:${change.id}:${change.stat}`;
    if (seen.has(key)) throw new Error('duplicate_numeric_patch_field');
    seen.add(key);
    const current = (group[change.id] as Record<string, unknown>)[change.stat];
    const updated = { ...group[change.id], [change.stat]: change.value };
    const groupName = change.type === 'unit' ? 'champions' : change.type === 'item' ? 'items' : 'monsters';
    HexlabConfigSchema.parse({ ...config, [groupName]: { ...group, [change.id]: updated } });
    changed ||= current !== change.value;
  }
  if (!changed) throw new Error('numeric_patch_has_no_effect');
  return [...changes].sort((a, b) => `${a.type}:${a.id}:${a.stat}`.localeCompare(`${b.type}:${b.id}:${b.stat}`));
}

function metric(value: unknown): boolean {
  if (!isObject(value)) return false;
  const { samples, wins, draws, winRate, confidenceInterval, averageDamageDealt, averageDamageTaken, averageSurvivalDuration } = value;
  return Number.isInteger(samples) && Number(samples) >= 0 && Number.isInteger(wins) && Number(wins) >= 0
    && Number.isInteger(draws) && Number(draws) >= 0 && Number(wins) + Number(draws) <= Number(samples)
    && finite(winRate) && winRate >= 0 && winRate <= 100
    && Array.isArray(confidenceInterval) && confidenceInterval.length === 2
    && confidenceInterval.every((entry) => finite(entry) && entry >= 0 && entry <= 100)
    && Number(confidenceInterval[0]) <= Number(confidenceInterval[1])
    && [averageDamageDealt, averageDamageTaken, averageSurvivalDuration].every((entry) => finite(entry) && entry >= 0);
}

function batch(value: unknown, battles: number, mode: 'pvp' | 'pve'): value is Record<string, unknown> {
  if (!isObject(value) || value.games !== battles || !Number.isInteger(value.draws) || Number(value.draws) < 0 || Number(value.draws) > battles) return false;
  for (const group of ['champions', 'items', 'compositions']) {
    if (!isObject(value[group]) || !Object.values(value[group]).every(metric)) return false;
  }
  return isObject(value.champions) && Object.keys(value.champions).length > 0
    && (mode !== 'pve' || (finite(value.clearRate) && value.clearRate >= 0 && value.clearRate <= 100));
}

function sameKeys(before: unknown, after: unknown): before is Record<string, unknown> {
  return isObject(before) && isObject(after) && Object.keys(before).length === Object.keys(after).length
    && Object.keys(before).every(key => Object.hasOwn(after, key));
}

function sameChanges(a: unknown, b: NumericChange[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((change, index) => {
    const expected = b[index];
    return isObject(change) && change.type === expected?.type && change.id === expected?.id
      && change.stat === expected?.stat && change.value === expected?.value;
  });
}

export function validateSimulationResult(result: unknown, request: SimulationInput): Record<string, unknown> {
  if (!isObject(result) || result.baselineConfigId !== request.baselineConfigId || result.engineId !== request.engineId
    || result.simulations !== request.battles || result.seed !== request.seed || result.mode !== request.mode
    || !sameChanges(result.appliedChanges, request.numericPatch)
    || !batch(result.before, request.battles, request.mode) || !batch(result.after, request.battles, request.mode)
    || !isObject(result.differences) || typeof result.methodology !== 'string'
    || !finite(result.evaluationDurationMs) || result.evaluationDurationMs < 0) {
    throw new Error('hexlab_result_identity_or_shape_mismatch');
  }
  for (const group of ['champions', 'items', 'compositions']) {
    if (!sameKeys(result.before[group], result.after[group])) throw new Error('hexlab_result_entity_mismatch');
  }
  const before = result.before as Record<string, any>;
  const after = result.after as Record<string, any>;
  const differences = result.differences as Record<string, any>;
  for (const group of ['champions', 'items']) {
    if (!sameKeys(before[group], differences[group])) throw new Error('hexlab_result_difference_mismatch');
    for (const id of Object.keys(before[group])) {
      const left = before[group][id] as Record<string, number>;
      const right = after[group][id] as Record<string, number>;
      const delta = differences[group][id] as Record<string, number>;
      for (const key of ['winRate', 'averageDamageDealt', 'averageDamageTaken', 'averageSurvivalDuration']) {
        if (!finite(delta[key]) || !finite(right[key]) || !finite(left[key])
          || Math.abs(delta[key] - (right[key] - left[key])) > 1e-8) throw new Error('hexlab_result_difference_mismatch');
      }
    }
  }
  if (request.mode === 'pve' && (!finite(differences.clearRate)
    || Math.abs(differences.clearRate - (Number(after.clearRate) - Number(before.clearRate))) > 1e-8)) {
    throw new Error('hexlab_result_difference_mismatch');
  }
  return result;
}

export class HexlabClient {
  constructor(private readonly baseUrl: string) {}

  async getConfig(): Promise<HexlabConfig> {
    return validateHexlabConfig(await this.request('/config', { method: 'GET' }, 10000));
  }

  async simulate(request: SimulationInput): Promise<Record<string, unknown>> {
    const result = await this.request('/simulate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: request.numericPatch, simulations: request.battles, seed: request.seed,
        mode: request.mode, expectedBaselineConfigId: request.baselineConfigId, expectedEngineId: request.engineId }),
    }, 125000);
    return validateSimulationResult(result, request);
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
        ...init, signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json', ...init.headers },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error('hexlab_timeout');
      throw new Error('hexlab_unavailable');
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error('hexlab_invalid_response'); }
    if (!response.ok) {
      if (response.status === 409) throw new Error('hexlab_baseline_changed');
      if (response.status === 429) throw new Error('hexlab_busy');
      throw new Error(`hexlab_http_${response.status}`);
    }
    return body;
  }
}
