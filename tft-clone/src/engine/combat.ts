import type { BattleOptions, BattleResult, BattleUnit, CombatEvent, GameConfig, Stats, Team, UnitSetup } from './types';
import { calculateDamage } from './damage';
import { BOARD_SIZE, MOVEMENT_INTERVAL, nextMovement } from './movement';
import { nearestEnemy } from './targeting';

const EPSILON = 1e-9;
const cloneUnit = (unit: BattleUnit): BattleUnit => ({ ...unit, position: { ...unit.position } });

/** Stats always originate in the supplied configuration; an item is a single additive modifier. */
export function deriveUnitStats(setup: UnitSetup, config: GameConfig): Stats {
  const champion = Object.hasOwn(config.champions, setup.championId) ? config.champions[setup.championId] : Object.hasOwn(config.monsters, setup.championId) ? config.monsters[setup.championId] : undefined;
  if (!champion) throw new Error(`Unknown champion or monster: ${setup.championId}`);
  const item = setup.itemId === undefined || !Object.hasOwn(config.items, setup.itemId) ? undefined : config.items[setup.itemId];
  if (setup.itemId !== undefined && !item) throw new Error(`Unknown item: ${setup.itemId}`);
  const stats: Stats = {
    hp: champion.hp,
    attackDamage: champion.attackDamage + (item?.attackDamage ?? 0),
    attackSpeed: champion.attackSpeed + (item?.attackSpeed ?? 0),
    armor: champion.armor + (item?.armor ?? 0),
    range: champion.range,
  };
  if (!Object.values(stats).every(Number.isFinite) || stats.hp <= 0 || stats.attackDamage < 0 || stats.attackSpeed <= 0 || stats.attackSpeed > 1000 || stats.range < 1) {
    throw new Error(`Invalid combat statistics for ${setup.championId}`);
  }
  return stats;
}

function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pure headless deterministic battle. Default 100ms ticks and 400ms movement.
 * Attacks start ready and retain fractional cooldowns, so attack speed is not
 * rounded to whole seconds. Seed shuffles initial initiative; it rotates each
 * tick. Damage is sequential: a unit killed earlier in a tick cannot attack.
 * Timeouts are draws even when one team has more remaining health.
 */
export function simulateBattle(
  teamA: UnitSetup[], teamB: UnitSetup[], config: GameConfig, seed = 42, options: BattleOptions = {},
): BattleResult {
  const timestep = options.timestep ?? 0.1;
  const maxDuration = options.maxDuration ?? 60;
  const recordEvents = options.recordEvents !== false;
  if (!Number.isInteger(seed) || !Number.isFinite(seed)) throw new Error('Seed must be a finite integer');
  if (!Number.isFinite(timestep) || timestep < 0.01 || timestep > 0.5) throw new Error('Timestep must be between 0.01 and 0.5 seconds');
  if (!Number.isFinite(maxDuration) || maxDuration < 0 || maxDuration > 300) throw new Error('Maximum duration must be between 0 and 300 seconds');
  if (!teamA.length || !teamB.length || teamA.length + teamB.length > BOARD_SIZE * BOARD_SIZE) throw new Error('Both teams need units and must fit on the board');
  const ids = new Set<string>();
  const tiles = new Set<string>();
  const createUnit = (setup: UnitSetup, team: Team): BattleUnit => {
    if (typeof setup.id !== 'string' || !setup.id || ids.has(setup.id)) throw new Error('Unit ids must be unique nonempty strings');
    ids.add(setup.id);
    const { x, y } = setup.position;
    if (![x, y].every(n => Number.isInteger(n) && n >= 0 && n < BOARD_SIZE)) throw new Error('Unit position must be on the 5×5 board');
    const tile = `${x},${y}`;
    if (tiles.has(tile)) throw new Error('Units cannot share a starting tile');
    tiles.add(tile);
    const stats = deriveUnitStats(setup, config);
    const champion = config.champions[setup.championId] ?? config.monsters[setup.championId];
    return {
      ...stats, id: setup.id, championId: setup.championId, name: champion.name, team,
      position: { x, y }, itemId: setup.itemId, maxHp: stats.hp,
      damageDealt: 0, damageTaken: 0, kills: 0, survivalDuration: 0, alive: true,
    };
  };
  const units = [...teamA.map(u => createUnit(u, 'A')), ...teamB.map(u => createUnit(u, 'B'))];
  const events: CombatEvent[] = [];
  if (recordEvents) events.push({ type: 'start', time: 0, units: units.map(cloneUnit) });
  const rng = randomGenerator(seed);
  const initiative = units.map((_, i) => i);
  for (let i = initiative.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [initiative[i], initiative[j]] = [initiative[j], initiative[i]];
  }
  const cooldowns = units.map(() => 0);
  const nextMoveTimes = units.map(() => 0);
  let winner: Team | 'draw' = 'draw';
  let duration = maxDuration;
  const steps = Math.floor((maxDuration + EPSILON) / timestep);

  battle: for (let step = 0; step <= steps; step++) {
    const time = Number((step * timestep).toFixed(8));
    for (let turn = 0; turn < initiative.length; turn++) {
      const i = initiative[(turn + step) % initiative.length];
      const unit = units[i];
      if (!unit.alive) continue;
      let target = nearestEnemy(unit, units);
      if (!target) { winner = unit.team; duration = time; break battle; }
      if (step > 0) cooldowns[i] = Math.max(-timestep, cooldowns[i] - timestep);
      let inRange = nearestEnemy(unit, units, unit.range);
      if (!inRange) {
        cooldowns[i] = Math.max(0, cooldowns[i]);
        if (time + EPSILON >= nextMoveTimes[i]) {
          nextMoveTimes[i] = time + MOVEMENT_INTERVAL;
          const to = nextMovement(unit, target, units);
          if (to) {
            const from = { ...unit.position };
            unit.position = to;
            if (recordEvents) events.push({ type: 'move', time, unitId: unit.id, from, to: { ...to } });
          }
        }
        continue;
      }
      while (cooldowns[i] <= EPSILON && inRange) {
        const damage = Math.min(inRange.hp, calculateDamage(unit.attackDamage, inRange.armor));
        inRange.hp = Math.max(0, inRange.hp - damage);
        unit.damageDealt += damage;
        inRange.damageTaken += damage;
        cooldowns[i] += 1 / unit.attackSpeed;
        if (recordEvents) events.push({ type: 'attack', time, unitId: unit.id, targetId: inRange.id, damage, targetHp: inRange.hp });
        if (inRange.hp <= EPSILON) {
          inRange.hp = 0;
          inRange.alive = false;
          inRange.survivalDuration = time;
          unit.kills++;
          if (recordEvents) events.push({ type: 'death', time, unitId: inRange.id, killerId: unit.id });
          if (!nearestEnemy(unit, units)) { winner = unit.team; duration = time; break battle; }
        }
        inRange = nearestEnemy(unit, units, unit.range);
      }
    }
  }
  for (const unit of units) if (unit.alive) unit.survivalDuration = duration;
  if (recordEvents) events.push({ type: 'end', time: duration, winner });
  return { winner, duration, units, survivors: units.filter(u => u.alive), events, seed };
}
