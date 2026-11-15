import { describe, expect, it } from 'vitest';
import { baseConfig } from '../src/config';
import { configIdentifier } from '../src/config/validation';
import { simulateBattle } from '../src/engine/combat';
import { compareBalance } from '../src/simulation/balanceComparison';
import { parseReplayLink, replaySetup, scanOutcomes } from '../src/replay/experiment';
import { engineIdentifier } from '../server/app';
import { frameAt, startingUnits } from '../src/replay/frame';

const baselineConfigId = configIdentifier(baseConfig);
const engineId = engineIdentifier();
const link = (body: object, extra = '') => `?replay=${encodeURIComponent(JSON.stringify(body))}${extra}`;
const yasuo = { baselineConfigId, engineId, changes: [{ type: 'unit', id: 'yasuo', stat: 'attackDamage', value: 20 }], simulations: 100, seed: 42, mode: 'pvp' };

describe('replay links', () => {
  it('ignores pages without a replay parameter', () => {
    expect(parseReplayLink('', baseConfig, engineId)).toBeNull();
  });
  it('parses the experiment, game, and focus', () => {
    const parsed = parseReplayLink(link(yasuo, '&game=7&focus=yasuo'), baseConfig, engineId)!;
    expect(parsed.experiment.request).toEqual({ changes: yasuo.changes, simulations: 100, seed: 42, mode: 'pvp' });
    expect(parsed.game).toBe(7);
    expect(parsed.focus).toBe('yasuo');
  });
  it('rejects a replay when its engine identity differs', () => {
    expect(() => parseReplayLink(link({ ...yasuo, engineId: 'a'.repeat(64) }), baseConfig, engineId)).toThrow(/renderer uses/);
  });
  it('drops out-of-range games and unknown champions', () => {
    const parsed = parseReplayLink(link(yasuo, '&game=101&focus=nobody'), baseConfig, engineId)!;
    expect(parsed.game).toBeUndefined();
    expect(parsed.focus).toBeUndefined();
  });
  it('rejects a different baseline, malformed JSON, and invalid patches', () => {
    expect(() => parseReplayLink(link({ ...yasuo, baselineConfigId: 'mini-tft-v1-00000000' }), baseConfig, engineId)).toThrow(/would not match/);
    expect(() => parseReplayLink('?replay=%7Bnope', baseConfig, engineId)).toThrow(/not valid JSON/);
    expect(() => parseReplayLink(link({ ...yasuo, simulations: 7 }), baseConfig, engineId)).toThrow(/valid Hexlab experiment/);
    expect(() => parseReplayLink(link({ ...yasuo, changes: [{ type: 'unit', id: 'nobody', stat: 'hp', value: 1 }] }), baseConfig, engineId)).toThrow();
  });
});

describe('replays reproduce the measured batch', () => {
  for (const mode of ['pvp', 'pve'] as const) {
    it(`recorded replays match unrecorded batch battles (${mode})`, async () => {
      const { experiment } = parseReplayLink(link({ ...yasuo, mode }), baseConfig, engineId)!;
      const setup = replaySetup(experiment, baseConfig);
      const outcomes = await scanOutcomes(setup);
      const measured = await compareBalance(experiment.request, baseConfig);
      expect(outcomes.filter(o => o.before === 'draw').length).toBe(measured.before.draws);
      expect(outcomes.filter(o => o.after === 'draw').length).toBe(measured.after.draws);
      for (const [index, m] of setup.matchups.entries()) {
        for (const [config, winner] of [[setup.baseline, outcomes[index].before], [setup.patched, outcomes[index].after]] as const) {
          const replay = simulateBattle(m.teamA, m.teamB, config, m.seed);
          const batch = simulateBattle(m.teamA, m.teamB, config, m.seed, { recordEvents: false });
          expect(replay.winner).toBe(winner);
          expect(replay.duration).toBe(batch.duration);
          expect(replay.units).toEqual(batch.units);
        }
      }
      if (mode === 'pve') {
        const clears = outcomes.filter((o, i) => o.before === (setup.matchups[i].teamA.some(u => u.championId === 'krug') ? 'B' : 'A')).length;
        expect(100 * clears / outcomes.length).toBeCloseTo(measured.before.clearRate!, 8);
      }
    });
  }

  it('the final replay frame matches the battle result', () => {
    const { experiment } = parseReplayLink(link(yasuo), baseConfig, engineId)!;
    const m = replaySetup(experiment, baseConfig).matchups[3];
    const result = simulateBattle(m.teamA, m.teamB, baseConfig, m.seed);
    const { units } = frameAt(startingUnits(result), result, result.duration);
    for (const unit of result.units) {
      const shown = units.find(u => u.id === unit.id)!;
      expect(shown.alive).toBe(unit.alive);
      expect(shown.hp).toBeCloseTo(unit.hp, 8);
      expect(shown.position).toEqual(unit.position);
    }
  });
});
