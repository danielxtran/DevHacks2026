import { createClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { fetchR, fetchReddit, type RpcClient } from './collectors.js';
import { beginSweep, failSweep, persistSweep } from './repository.js';

function rpcClient(url: string, key: string, schema: 'mockreddit' | 'mockr'): RpcClient {
  const supabase = createClient(url, key, {
    db: { schema }, auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async rpc(name, args) {
      const { data, error } = await supabase.rpc(name as never, args as never);
      return { data, error: error ? { message: error.message } : null };
    },
  };
}

export class SourceCollector {
  private readonly reddit: RpcClient | null;
  private readonly r: RpcClient | null;
  constructor(private readonly pool: Pool, options: {
    url: string; anonKey: string | undefined; maxItems: number;
  }) {
    this.reddit = options.anonKey ? rpcClient(options.url, options.anonKey, 'mockreddit') : null;
    this.r = options.anonKey ? rpcClient(options.url, options.anonKey, 'mockr') : null;
    this.maxItems = options.maxItems;
  }
  private readonly maxItems: number;

  async runOnce(): Promise<void> {
    await Promise.all([
      this.collect('reddit', this.reddit, () => fetchReddit(this.reddit!, this.maxItems)),
      this.collect('r', this.r, () => fetchR(this.r!, this.maxItems)),
    ]);
  }

  private async collect(source: 'reddit' | 'r', client: RpcClient | null, fetch: () => ReturnType<typeof fetchR>): Promise<void> {
    const sweepId = await beginSweep(this.pool, source);
    try {
      if (!client) throw new Error('Source collection is pending: SUPABASE_ANON_KEY is not configured.');
      const result = await fetch();
      const saved = await persistSweep(this.pool, { id: sweepId, source, pages: result.pages, items: result.items, truncated: result.truncated });
      console.info(`Source sweep ${source}: ${saved.status}; ${result.items.length} items, ${result.pages} pages, ${saved.pending} unresolved replies.`);
    } catch (error) {
      await failSweep(this.pool, sweepId, error);
      console.error(`Source sweep ${source} failed:`, error);
    }
  }
}
