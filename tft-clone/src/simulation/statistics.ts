import type { PerformanceMetric } from '../engine/types';

export interface Accumulator {
  samples: number;
  wins: number;
  draws: number;
  damageDealt: number;
  damageTaken: number;
  survivalDuration: number;
}

export function createAccumulator(): Accumulator {
  return { samples: 0, wins: 0, draws: 0, damageDealt: 0, damageTaken: 0, survivalDuration: 0 };
}

/** Approximate marginal 95% Wilson interval; side-swapped games are correlated. */
export function wilsonInterval(wins: number, samples: number): [number, number] {
  if (samples === 0) return [0, 100];
  const z = 1.959963984540054;
  const proportion = wins / samples;
  const denominator = 1 + z * z / samples;
  const center = (proportion + z * z / (2 * samples)) / denominator;
  const half = z * Math.sqrt(proportion * (1 - proportion) / samples + z * z / (4 * samples * samples)) / denominator;
  return [wins === 0 ? 0 : Math.max(0, center - half) * 100, wins === samples ? 100 : Math.min(1, center + half) * 100];
}

export function finalize(accumulator: Accumulator): PerformanceMetric {
  const divisor = accumulator.samples || 1;
  return {
    samples: accumulator.samples,
    wins: accumulator.wins,
    draws: accumulator.draws,
    winRate: 100 * accumulator.wins / divisor,
    confidenceInterval: wilsonInterval(accumulator.wins, accumulator.samples),
    averageDamageDealt: accumulator.damageDealt / divisor,
    averageDamageTaken: accumulator.damageTaken / divisor,
    averageSurvivalDuration: accumulator.survivalDuration / divisor,
  };
}
