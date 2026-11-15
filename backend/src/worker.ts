import type { DiscoveryAgent } from './discovery.js';
import type { SourceCollector } from './source-worker.js';
import type { WorkflowJobWorker } from './workflow-worker.js';

type CollectorWorker = Pick<SourceCollector, 'runOnce' | 'cancelActiveSweep'>;
type DiscoveryWorker = Pick<DiscoveryAgent, 'processPending'>;
type CommandWorker = Pick<WorkflowJobWorker, 'processPending'>;

export class WorkerLoop {
  private stopped = true;
  private sourceTimer: NodeJS.Timeout | undefined;
  private commandTimer: NodeJS.Timeout | undefined;
  private sourceActive: Promise<void> | undefined;
  private commandActive: Promise<void> | undefined;

  constructor(
    private readonly collector: CollectorWorker,
    private readonly discovery: DiscoveryWorker,
    private readonly intervalMs = 5000,
    private readonly commands?: CommandWorker,
    private readonly commandIntervalMs = 1000,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.scheduleSource();
    if (this.commands) this.scheduleCommands();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.sourceTimer) clearTimeout(this.sourceTimer);
    if (this.commandTimer) clearTimeout(this.commandTimer);
    this.sourceTimer = undefined;
    this.commandTimer = undefined;
    this.collector.cancelActiveSweep();
    await Promise.all([this.sourceActive, this.commandActive]);
  }

  private scheduleSource(): void {
    if (this.stopped || this.sourceActive) return;
    this.sourceActive = this.iterateSources();
    void this.sourceActive.finally(() => {
      this.sourceActive = undefined;
      if (!this.stopped) this.sourceTimer = setTimeout(() => this.scheduleSource(), this.intervalMs);
    });
  }

  private scheduleCommands(): void {
    if (this.stopped || this.commandActive || !this.commands) return;
    this.commandActive = this.commands.processPending().catch(error => {
      console.error('Workflow command worker iteration failed:', error);
    });
    void this.commandActive.finally(() => {
      this.commandActive = undefined;
      if (!this.stopped) this.commandTimer = setTimeout(() => this.scheduleCommands(), this.commandIntervalMs);
    });
  }

  private async iterateSources(): Promise<void> {
    try {
      await this.collector.runOnce();
      if (!this.stopped) await this.discovery.processPending();
    } catch (error) {
      console.error('Source worker iteration failed:', error);
    }
  }
}
