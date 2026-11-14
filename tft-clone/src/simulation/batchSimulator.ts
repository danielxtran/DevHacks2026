import { simulateBattle } from '../engine/combat';
import type { BatchStatistics, BattleUnit, GameConfig, Matchup, Team } from '../engine/types';
import { createAccumulator, finalize, type Accumulator } from './statistics';

export type ProgressCallback = (progress: number) => void;

function addSample(record: Record<string, Accumulator>, key: string, units: BattleUnit[], winner: Team | 'draw', team: Team, aggregateTeam = false): void {
  if (!units.length) return;
  const accumulator = record[key] ??= createAccumulator();
  accumulator.samples++;
  accumulator.wins += Number(winner === team);
  accumulator.draws += Number(winner === 'draw');
  const divisor = aggregateTeam ? 1 : units.length;
  accumulator.damageDealt += units.reduce((sum, unit) => sum + unit.damageDealt, 0) / divisor;
  accumulator.damageTaken += units.reduce((sum, unit) => sum + unit.damageTaken, 0) / divisor;
  accumulator.survivalDuration += units.reduce((sum, unit) => sum + unit.survivalDuration, 0) / units.length;
}

/** All averages use the same eligible team-game denominator as the win rate. */
export async function runBatch(matchups: Matchup[], config: GameConfig, onProgress?: ProgressCallback): Promise<BatchStatistics> {
  const champions: Record<string, Accumulator> = Object.fromEntries(Object.keys(config.champions).map(id => [id, createAccumulator()]));
  const items: Record<string, Accumulator> = Object.fromEntries(Object.keys(config.items).map(id => [id, createAccumulator()]));
  const compositions: Record<string, Accumulator> = {};
  let draws = 0;
  let pveGames = 0;
  let clears = 0;
  onProgress?.(0);
  for (let index = 0; index < matchups.length; index++) {
    const matchup = matchups[index];
    const result = simulateBattle(matchup.teamA, matchup.teamB, config, matchup.seed, { recordEvents: false });
    draws += Number(result.winner === 'draw');
    const teams = {
      A: result.units.filter(unit => unit.team === 'A'),
      B: result.units.filter(unit => unit.team === 'B'),
    };
    const pve = result.units.some(unit => Object.hasOwn(config.monsters, unit.championId));
    const playerTeam: Team = teams.A.some(unit => Object.hasOwn(config.champions, unit.championId)) ? 'A' : 'B';
    if (pve) {
      pveGames++;
      clears += Number(result.winner === playerTeam);
    }
    for (const team of ['A', 'B'] as const) {
      const own = teams[team].filter(unit => Object.hasOwn(config.champions, unit.championId));
      const enemy = teams[team === 'A' ? 'B' : 'A'];
      const enemyChampions = new Set(enemy.map(unit => unit.championId));
      for (const championId of new Set(own.map(unit => unit.championId))) {
        if (!enemyChampions.has(championId)) addSample(champions, championId, own.filter(unit => unit.championId === championId), result.winner, team);
      }
      const enemyItems = new Set(enemy.map(unit => unit.itemId).filter(Boolean));
      for (const itemId of new Set(own.map(unit => unit.itemId).filter((id): id is string => Boolean(id)))) {
        if (!enemyItems.has(itemId)) addSample(items, itemId, own.filter(unit => unit.itemId === itemId), result.winner, team);
      }
      if (own.length) {
        const composition = own.map(unit => unit.championId).sort().join(' + ');
        const enemyComposition = enemy.map(unit => unit.championId).sort().join(' + ');
        if (composition !== enemyComposition) addSample(compositions, composition, own, result.winner, team, true);
      }
    }
    if ((index + 1) % 50 === 0 || index === matchups.length - 1) {
      onProgress?.((index + 1) / matchups.length);
      // Keep API health requests and browser worker messages responsive in large batches.
      if (index !== matchups.length - 1) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
  const finish = (values: Record<string, Accumulator>) => Object.fromEntries(Object.entries(values).map(([key, accumulator]) => [key, finalize(accumulator)]));
  return { games: matchups.length, draws, champions: finish(champions), items: finish(items), compositions: finish(compositions), ...(pveGames ? { clearRate: 100 * clears / pveGames } : {}) };
}
