/// <reference lib="webworker" />
import { replaySetup, scanOutcomes, type GameOutcome, type ReplayExperiment } from './experiment';
import type { GameConfig } from '../engine/types';

export interface ScanRequest { experiment: ReplayExperiment; config: GameConfig }
export type ScanResponse = { type: 'progress'; done: number } | { type: 'result'; outcomes: GameOutcome[] } | { type: 'error'; error: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = async (event: MessageEvent<ScanRequest>) => {
  try {
    const outcomes = await scanOutcomes(replaySetup(event.data.experiment, event.data.config), done => worker.postMessage({ type: 'progress', done } satisfies ScanResponse));
    worker.postMessage({ type: 'result', outcomes } satisfies ScanResponse);
  } catch (error) {
    worker.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'Replay scan failed.' } satisfies ScanResponse);
  }
};
