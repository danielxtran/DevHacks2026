import type { GameConfig, Matchup, Position, UnitSetup } from '../engine/types';
import { createRandom, shuffle } from './random';

const homeTiles: Position[] = Array.from({ length: 10 }, (_, index) => ({ x: index % 5, y: Math.floor(index / 5) }));
const rotate = (position: Position): Position => ({ x: 4 - position.x, y: 4 - position.y });
const oppositeSide = (team: UnitSetup[]): UnitSetup[] => team.map(unit => ({ ...unit, position: rotate(unit.position) }));

/**
 * Uniformly shuffled cyclic strata balance representation, while independent
 * shuffles randomize teammates, formation and items. Every adjacent pair plays
 * the same units/items/seed with a 180-degree board rotation and exchanged sides.
 * PvP draws six distinct champions, eliminating ambiguous champion mirror games.
 */
export function generateMatchups(count: number, seed: number, config: GameConfig, mode: 'pvp' | 'pve' = 'pvp'): Matchup[] {
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('Matchup count must be an integer from 1 to 10000.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be a uint32 integer.');
  const champions = Object.keys(config.champions).sort();
  const needed = mode === 'pvp' ? 6 : 3;
  if (champions.length < needed) throw new Error(`This mode requires at least ${needed} different champions.`);
  const monsterId = Object.hasOwn(config.monsters, 'krug') ? 'krug' : Object.keys(config.monsters).sort()[0];
  if (mode === 'pve' && !monsterId) throw new Error('PvE requires a configured monster.');
  const random = createRandom(seed);
  const itemIds: (string | undefined)[] = [undefined, ...Object.keys(config.items).sort()];
  const matchups: Matchup[] = [];
  let roster: string[] = [];
  for (let pair = 0; matchups.length < count; pair++) {
    if (pair % champions.length === 0) roster = shuffle(champions, random);
    const offset = (pair % champions.length) * needed;
    const selection = shuffle(Array.from({ length: needed }, (_, index) => roster[(offset + index) % roster.length]), random);
    const tilesA = shuffle(homeTiles, random);
    const tilesB = shuffle(homeTiles, random);
    const buildUnit = (championId: string, index: number, position: Position): UnitSetup => {
      const itemId = itemIds[Math.floor(random() * itemIds.length)];
      return { id: `p${pair}-u${index}`, championId, position: { ...position }, ...(itemId ? { itemId } : {}) };
    };
    const teamA = selection.slice(0, 3).map((id, index) => buildUnit(id, index, tilesA[index]));
    const teamB: UnitSetup[] = mode === 'pvp'
      ? selection.slice(3).map((id, index) => buildUnit(id, index + 3, rotate(tilesB[index])))
      : [{ id: `p${pair}-monster`, championId: monsterId, position: { x: 2, y: 4 } }];
    const battleSeed = Math.floor(random() * 4294967296);
    matchups.push({ teamA, teamB, seed: battleSeed });
    if (matchups.length < count) matchups.push({ teamA: oppositeSide(teamB), teamB: oppositeSide(teamA), seed: battleSeed });
  }
  return matchups;
}
