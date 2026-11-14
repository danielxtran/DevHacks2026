import { applyPatch, configIdentifier, validateSimulationRequest } from '../config/validation';
import type { BalanceComparison, GameConfig, MetricDifference, PerformanceMetric, SimulationRequest } from '../engine/types';
import { runBatch, type ProgressCallback } from './batchSimulator';
import { generateMatchups } from './matchups';

function differences(before: Record<string, PerformanceMetric>, after: Record<string, PerformanceMetric>): Record<string, MetricDifference> {
  return Object.fromEntries(Object.keys(before).map(id => [id, {
    winRate: after[id].winRate - before[id].winRate,
    averageDamageDealt: after[id].averageDamageDealt - before[id].averageDamageDealt,
    averageDamageTaken: after[id].averageDamageTaken - before[id].averageDamageTaken,
    averageSurvivalDuration: after[id].averageSurvivalDuration - before[id].averageSurvivalDuration,
  }]));
}

export async function compareBalance(input: SimulationRequest, baselineConfig: GameConfig, onProgress?: ProgressCallback): Promise<BalanceComparison> {
  const started = performance.now();
  const request = validateSimulationRequest(input, baselineConfig);
  const modified = applyPatch(baselineConfig, request.changes);
  const mode = request.mode ?? 'pvp';
  const matchups = generateMatchups(request.simulations, request.seed, baselineConfig, mode);
  const before = await runBatch(matchups, baselineConfig, progress => onProgress?.(progress / 2));
  const after = await runBatch(matchups, modified, progress => onProgress?.(0.5 + progress / 2));
  return {
    baselineConfigId: configIdentifier(baselineConfig),
    appliedChanges: request.changes.map(change => ({ ...change })),
    simulations: request.simulations,
    seed: request.seed,
    mode,
    before,
    after,
    differences: {
      champions: differences(before.champions, after.champions),
      items: differences(before.items, after.items),
      ...(mode === 'pve' ? { clearRate: (after.clearRate ?? 0) - (before.clearRate ?? 0) } : {}),
    },
    evaluationDurationMs: performance.now() - started,
    methodology: 'Paired real simulations with identical seeded compositions, placements, items and combat seeds before/after. Adjacent games exchange sides and rotate the board 180 degrees. Cyclic stratification balances champion appearances; each PvP matchup has six distinct champions. Champion and item mirrors are excluded from every corresponding metric. Champion samples count eligible team-games; item samples count eligible team-games containing that item, averaging the holders; composition damage totals the team and survival averages its members. Draws are non-wins and reported separately. Rates and 95% marginal Wilson intervals are percentages; deltas are percentage points. Intervals are descriptive approximations because paired games and shared teams are correlated; they are not paired significance tests. PvE rates count player-team clears, including when the player team is on side B. These are simulated outcomes, not predictions for live TFT.',
  };
}
