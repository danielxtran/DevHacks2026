import type { BattleUnit, Position } from './types';

/** Orthogonal tile distance. Ranged attacks ignore intervening units. */
export function distance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Stable lexical unit id breaks equal-distance ties, independently of array order. */
export function nearestEnemy(unit: BattleUnit, units: BattleUnit[], maxRange = Infinity): BattleUnit | undefined {
  let nearest: BattleUnit | undefined;
  let best = maxRange;
  for (const candidate of units) {
    if (!candidate.alive || candidate.team === unit.team) continue;
    const d = distance(unit.position, candidate.position);
    if (d <= best && (!nearest || d < best || candidate.id < nearest.id)) {
      nearest = candidate;
      best = d;
    }
  }
  return nearest;
}
