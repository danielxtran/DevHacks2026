import { describe, expect, it } from 'vitest';
import { baseConfig } from '../src/config';
import { applyPatch } from '../src/config/validation';
import { generateMatchups } from '../src/simulation/matchups';
import { runBatch } from '../src/simulation/batchSimulator';
import { compareBalance } from '../src/simulation/balanceComparison';
import { finalize, createAccumulator, wilsonInterval } from '../src/simulation/statistics';

const totals = (count: number, mode: 'pvp' | 'pve' = 'pvp') => {
  const representation: Record<string, number> = Object.fromEntries(Object.keys(baseConfig.champions).map(id => [id, 0]));
  for (const matchup of generateMatchups(count, 42, baseConfig, mode)) {
    for (const unit of [...matchup.teamA, ...matchup.teamB]) if (unit.championId in representation) representation[unit.championId]++;
  }
  return Object.values(representation);
};

describe('seeded matchup design', () => {
  it('reproduces identical compositions, items, positions and seeds', () => {
    expect(generateMatchups(100, 42, baseConfig)).toEqual(generateMatchups(100, 42, baseConfig));
    expect(generateMatchups(100, 42, baseConfig)).not.toEqual(generateMatchups(100, 43, baseConfig));
  });

  it.each([100, 1000, 5000, 10000])('balances all champion appearances to within two over %i games', count => {
    const counts = totals(count);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(count * 6);
  });

  it('has unique occupants and six distinct champions, with paired side-swapped items and placements', () => {
    const games = generateMatchups(100, 12, baseConfig);
    games.forEach(game => {
      const all = [...game.teamA, ...game.teamB];
      expect(new Set(all.map(unit => unit.championId)).size).toBe(6);
      expect(new Set(all.map(unit => `${unit.position.x},${unit.position.y}`)).size).toBe(6);
      expect(new Set(all.map(unit => unit.id)).size).toBe(6);
    });
    const rotate = (team: typeof games[number]['teamA']) => team.map(unit => ({ ...unit, position: { x: 4 - unit.position.x, y: 4 - unit.position.y } }));
    for (let index = 0; index < games.length; index += 2) {
      expect(games[index + 1].teamA).toEqual(rotate(games[index].teamB));
      expect(games[index + 1].teamB).toEqual(rotate(games[index].teamA));
      expect(games[index + 1].seed).toBe(games[index].seed);
    }
  });

  it('balances PvE parties and swaps the monster between sides', () => {
    const games = generateMatchups(100, 42, baseConfig, 'pve');
    expect(games[0].teamA).toHaveLength(3);
    expect(games[0].teamB[0].championId).toBe('krug');
    expect(games[1].teamA[0].championId).toBe('krug');
    expect(games[1].teamB).toHaveLength(3);
    const counts = totals(100, 'pve');
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  });
});

describe('batch aggregation and comparisons', () => {
  it('reproduces exactly the same metrics twice from the same inputs', async () => {
    const matchups = generateMatchups(100, 123, baseConfig);
    expect(await runBatch(matchups, baseConfig)).toEqual(await runBatch(matchups, baseConfig));
  });

  it('reports zero deltas for an empty patch using identical matchups', async () => {
    const progress: number[] = [];
    const result = await compareBalance({ changes: [], simulations: 100, seed: 42 }, baseConfig, value => progress.push(value));
    expect(result.before).toEqual(result.after);
    expect(result.simulations).toBe(100);
    expect(result.before.games).toBe(100);
    for (const delta of Object.values(result.differences.champions)) {
      expect(delta).toEqual({ winRate: 0, averageDamageDealt: 0, averageDamageTaken: 0, averageSurvivalDuration: 0 });
    }
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });

  it('applies real configuration changes without mutating the saved baseline', async () => {
    const before = JSON.stringify(baseConfig);
    const patch = [{ type: 'unit' as const, id: 'yasuo', stat: 'attackDamage' as const, value: 0 }];
    const modified = applyPatch(baseConfig, patch);
    expect(modified.champions.yasuo.attackDamage).toBe(0);
    expect(baseConfig.champions.yasuo.attackDamage).toBe(25);
    const result = await compareBalance({ changes: patch, simulations: 100, seed: 42 }, baseConfig);
    expect(result.after.champions.yasuo.averageDamageDealt).toBeLessThan(result.before.champions.yasuo.averageDamageDealt);
    expect(result.appliedChanges).toEqual(patch);
    for (const id of Object.keys(baseConfig.champions)) expect(result.before.champions[id].samples).toBe(result.after.champions[id].samples);
    expect(JSON.stringify(baseConfig)).toBe(before);
  });

  it('excludes champion, item and composition mirrors consistently from every associated metric', async () => {
    const stats = await runBatch([{
      teamA: [{ id: 'a', championId: 'yasuo', position: { x: 1, y: 2 }, itemId: 'bf_sword' }],
      teamB: [{ id: 'b', championId: 'yasuo', position: { x: 2, y: 2 }, itemId: 'bf_sword' }], seed: 9,
    }], baseConfig);
    expect(stats.champions.yasuo.samples).toBe(0);
    expect(stats.champions.yasuo.averageDamageDealt).toBe(0);
    expect(stats.items.bf_sword.samples).toBe(0);
    expect(stats.compositions).toEqual({});
  });

  it('counts PvE successes on either board side as player clear rate', async () => {
    const config = structuredClone(baseConfig);
    for (const champion of Object.values(config.champions)) {
      champion.attackDamage = 1000;
      champion.range = 4;
    }
    config.monsters.krug.hp = 1;
    config.monsters.krug.attackDamage = 0;
    const result = await runBatch(generateMatchups(14, 42, config, 'pve'), config);
    expect(result.clearRate).toBe(100);
    for (const champion of Object.values(result.champions)) {
      expect(champion.samples).toBe(6);
      expect(champion.winRate).toBe(100);
    }
  });

  it('rejects invalid patches before simulation', async () => {
    await expect(compareBalance({ changes: [{ type: 'unit', id: 'not_real', stat: 'hp', value: 10 }], simulations: 100, seed: 42 }, baseConfig)).rejects.toThrow();
  });
});

describe('uncertainty estimates', () => {
  it('calculates a bounded 95% interval around an observed rate', () => {
    const interval = wilsonInterval(50, 100);
    expect(interval[0]).toBeCloseTo(40.383, 2);
    expect(interval[1]).toBeCloseTo(59.617, 2);
    expect(wilsonInterval(0, 100)[0]).toBe(0);
    expect(wilsonInterval(100, 100)[1]).toBe(100);
    expect(wilsonInterval(0, 0)).toEqual([0, 100]);
  });
  it('counts draws as non-wins and reports their count', () => {
    const accumulator = { ...createAccumulator(), samples: 10, wins: 4, draws: 2 };
    expect(finalize(accumulator).winRate).toBe(40);
    expect(finalize(accumulator).draws).toBe(2);
  });
});
