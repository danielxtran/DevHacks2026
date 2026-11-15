import { z } from 'zod';
import { simulateBattle } from '../engine/combat';
import type { GameConfig, Matchup, SimulationRequest, Team } from '../engine/types';
import { applyPatch, configIdentifier, simulationRequestSchema, validateSimulationRequest } from '../config/validation';
import { generateMatchups } from '../simulation/matchups';

/** What Patchwork links to: the exact request Hexlab evaluated, bound to its baseline fingerprint. */
export interface ReplayExperiment { request: SimulationRequest & { mode: 'pvp' | 'pve' }; baselineConfigId: string; engineId: string }
export interface ReplayLink { experiment: ReplayExperiment; game?: number; focus?: string }

const linkSchema = simulationRequestSchema.extend({ baselineConfigId: z.string().min(1).max(120), engineId: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

/** Parse `?replay=<json>&game=<1-based>&focus=<championId>`. Returns null when no replay is requested. */
export function parseReplayLink(search: string, config: GameConfig, currentEngineId: string): ReplayLink | null {
  const params = new URLSearchParams(search);
  const raw = params.get('replay');
  if (raw === null) return null;
  let json: unknown;
  try { json = JSON.parse(raw); } catch { throw new Error('The replay link is not valid JSON. Open it again from Patchwork.'); }
  const parsed = linkSchema.safeParse(json);
  if (!parsed.success) throw new Error('The replay link does not describe a valid Hexlab experiment.');
  const { baselineConfigId, engineId, ...rest } = parsed.data;
  const request = { ...validateSimulationRequest(rest, config), mode: rest.mode ?? 'pvp' } as ReplayExperiment['request'];
  if (baselineConfigId !== configIdentifier(config)) {
    throw new Error(`This experiment ran on baseline ${baselineConfigId}, but this Hexlab build uses ${configIdentifier(config)}. Replays would not match the measured results.`);
  }
  if (engineId !== currentEngineId) throw new Error(`This experiment ran on engine ${engineId}, but this Hexlab renderer uses ${currentEngineId}. Replays would not match the measured results.`);
  const game = Number(params.get('game'));
  const focus = params.get('focus') ?? undefined;
  return {
    experiment: { request, baselineConfigId, engineId },
    ...(Number.isInteger(game) && game >= 1 && game <= request.simulations ? { game } : {}),
    ...(focus && Object.hasOwn(config.champions, focus) ? { focus } : {}),
  };
}

/** The identical matchups and configurations `compareBalance` used for this experiment. */
export function replaySetup(experiment: ReplayExperiment, baseline: GameConfig): { matchups: Matchup[]; baseline: GameConfig; patched: GameConfig } {
  const { request } = experiment;
  return {
    matchups: generateMatchups(request.simulations, request.seed, baseline, request.mode),
    baseline,
    patched: applyPatch(baseline, request.changes),
  };
}

export type Winner = Team | 'draw';
export interface GameOutcome { before: Winner; after: Winner; beforeDuration: number; afterDuration: number }

/** Re-simulates every game with event recording off, exactly as the batch did. */
export async function scanOutcomes(setup: ReturnType<typeof replaySetup>, onProgress?: (done: number) => void): Promise<GameOutcome[]> {
  const outcomes: GameOutcome[] = [];
  for (let i = 0; i < setup.matchups.length; i++) {
    const m = setup.matchups[i];
    const a = simulateBattle(m.teamA, m.teamB, setup.baseline, m.seed, { recordEvents: false });
    const b = simulateBattle(m.teamA, m.teamB, setup.patched, m.seed, { recordEvents: false });
    outcomes.push({ before: a.winner, after: b.winner, beforeDuration: a.duration, afterDuration: b.duration });
    if ((i + 1) % 200 === 0 || i === setup.matchups.length - 1) {
      onProgress?.(i + 1);
      if (i !== setup.matchups.length - 1) await new Promise<void>(r => setTimeout(r, 0));
    }
  }
  return outcomes;
}
