/// <reference lib="webworker" />
import { compareBalance } from './balanceComparison';
import type { BalanceComparison, GameConfig, SimulationRequest } from '../engine/types';

export interface ComparisonWorkerRequest { type: 'compare'; request: SimulationRequest; config: GameConfig }
export type ComparisonWorkerResponse = { type: 'progress'; progress: number } | { type: 'result'; result: BalanceComparison } | { type: 'error'; error: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;
let busy = false;
worker.onmessage = async (event: MessageEvent<ComparisonWorkerRequest>) => {
  if (event.data?.type !== 'compare') return;
  if (busy) {
    worker.postMessage({ type: 'error', error: 'A simulation batch is already running.' } satisfies ComparisonWorkerResponse);
    return;
  }
  busy = true;
  try {
    const result = await compareBalance(event.data.request, event.data.config, progress => worker.postMessage({ type: 'progress', progress } satisfies ComparisonWorkerResponse));
    worker.postMessage({ type: 'result', result } satisfies ComparisonWorkerResponse);
  } catch (error) {
    worker.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'Simulation failed.' } satisfies ComparisonWorkerResponse);
  } finally {
    busy = false;
  }
};
