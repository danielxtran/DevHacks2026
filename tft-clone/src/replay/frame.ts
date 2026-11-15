import type { BattleResult, BattleUnit } from '../engine/types';

export interface AttackFlash { from: BattleUnit; to: BattleUnit; damage: number }

export function startingUnits(result: BattleResult | null): BattleUnit[] {
  const start = result?.events.find(e => e.type === 'start');
  return start?.type === 'start' ? structuredClone(start.units) : [];
}

/** Board state at `time`, rebuilt only from the simulator's recorded events. */
export function frameAt(initial: BattleUnit[], result: BattleResult | null, time: number): { units: BattleUnit[]; attacks: AttackFlash[] } {
  const units = structuredClone(initial);
  const attacks: AttackFlash[] = [];
  if (result) for (const event of result.events) {
    if (event.time > time) break;
    if (event.type === 'move') { const u = units.find(u => u.id === event.unitId); if (u) u.position = { ...event.to }; }
    if (event.type === 'attack') {
      const from = units.find(u => u.id === event.unitId), to = units.find(u => u.id === event.targetId);
      if (to) to.hp = event.targetHp;
      if (from && to && time - event.time < 0.2) attacks.push({ from: structuredClone(from), to: structuredClone(to), damage: event.damage });
    }
    if (event.type === 'death') { const u = units.find(u => u.id === event.unitId); if (u) { u.alive = false; u.hp = 0; } }
  }
  return { units, attacks };
}
