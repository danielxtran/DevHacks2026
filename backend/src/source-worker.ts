import type { Pool } from 'pg';
import { fetchR, fetchReddit, RequestPacer, type CollectorHttpRuntime, type SourceSweep } from './collectors.js';
import type { Feedback } from './contracts.js';
import { beginSweep, failSweep, persistSweep } from './repository.js';

export class SourceCollector {
  private readonly pacers: Record<'reddit' | 'r', RequestPacer>;
  private activeController: AbortController | undefined;
  private readonly maxItems: number;

  constructor(private readonly pool: Pool, private readonly options: {
    riotditBaseUrl: string;
    rBaseUrl: string;
    maxItems: number;
    http?: CollectorHttpRuntime;
  }) {
    this.maxItems = options.maxItems;
    const now = options.http?.now ?? Date.now;
    const wait = options.http?.wait;
    this.pacers = {
      reddit: new RequestPacer('reddit', now, wait),
      r: new RequestPacer('r', now, wait),
    };
  }

  async runOnce(): Promise<void> {
    if (this.activeController) return;
    const controller = new AbortController();
    this.activeController = controller;
    try {
      await Promise.all([
        this.collect('reddit', this.options.riotditBaseUrl, controller.signal),
        this.collect('r', this.options.rBaseUrl, controller.signal),
      ]);
    } finally {
      if (this.activeController === controller) this.activeController = undefined;
    }
  }

  cancelActiveSweep(): void {
    this.activeController?.abort(new Error('Source collection cancelled during worker shutdown.'));
  }

  private async collect(source: 'reddit' | 'r', baseUrl: string, signal: AbortSignal): Promise<void> {
    let sweepId: string | undefined;
    try {
      sweepId = await beginSweep(this.pool, source);
      const runtime = { ...this.options.http, signal, pacer: this.pacers[source] };
      const result: SourceSweep<Feedback> = source === 'reddit'
        ? await fetchReddit(baseUrl, this.maxItems, runtime)
        : await fetchR(baseUrl, this.maxItems, runtime);
      const saved = await persistSweep(this.pool, {
        id: sweepId, source, pages: result.pages, items: result.items, truncated: result.truncated,
      });
      console.info(`Source sweep ${source}: ${saved.status}; ${result.items.length} items, ${result.pages} pages, ${saved.pending} unresolved replies.`);
    } catch (error) {
      if (sweepId) {
        try { await failSweep(this.pool, sweepId, error); }
        catch (failureError) { console.error(`Could not mark source sweep ${source} failed:`, failureError); }
      }
      console.error(`Source sweep ${source} failed:`, error);
    }
  }
}
