import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkerLoop } from './worker.js';

test('worker serializes collection and cancels its active sweep on shutdown', async () => {
  let runs = 0;
  let cancelled = 0;
  let discoveryCalls = 0;
  let finish!: () => void;
  const activeSweep = new Promise<void>((resolve) => { finish = resolve; });
  const collector = {
    async runOnce() { runs++; await activeSweep; },
    cancelActiveSweep() { cancelled++; finish(); },
  };
  const worker = new WorkerLoop(collector, { async processPending() { discoveryCalls++; } });
  worker.start();
  worker.start();
  assert.equal(runs, 1);
  assert.equal(discoveryCalls, 0);
  await worker.stop();
  assert.equal(cancelled, 1);
  assert.equal(runs, 1);
  assert.equal(discoveryCalls, 0);
});
