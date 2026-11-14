import type { DiscoveryAgent } from './discovery.js';
import type { SourceCollector } from './source-worker.js';

export class WorkerLoop {
  private stopped = true;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly collector: SourceCollector, private readonly discovery: DiscoveryAgent, private readonly intervalMs = 5000) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      await this.collector.runOnce();
      await this.discovery.processPending();
    } catch (error) {
      console.error('Background worker iteration failed:', error);
    } finally {
      this.running = false;
      if (!this.stopped) this.timer = setTimeout(() => void this.tick(), this.intervalMs);
    }
  }
}
