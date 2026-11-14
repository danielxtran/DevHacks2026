import type { DiscoveryAgent } from './discovery.js';
import type { SourceCollector } from './source-worker.js';

type CollectorWorker = Pick<SourceCollector, 'runOnce' | 'cancelActiveSweep'>;
type DiscoveryWorker = Pick<DiscoveryAgent, 'processPending'>;

export class WorkerLoop {
  private stopped = true;
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;

  constructor(private readonly collector: CollectorWorker, private readonly discovery: DiscoveryWorker, private readonly intervalMs = 5000) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.scheduleTick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.collector.cancelActiveSweep();
    await this.active;
  }

  private scheduleTick(): void {
    if (this.stopped || this.active) return;
    this.active = this.iterate();
    void this.active.finally(() => {
      this.active = undefined;
      if (!this.stopped) this.timer = setTimeout(() => this.scheduleTick(), this.intervalMs);
    });
  }

  private async iterate(): Promise<void> {
    try {
      await this.collector.runOnce();
      if (!this.stopped) await this.discovery.processPending();
    } catch (error) {
      console.error('Background worker iteration failed:', error);
    }
  }
}
