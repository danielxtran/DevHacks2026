import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// All reads go to the mockr schema. Never touch `public` or `mockreddit` from this app.
export type Db = SupabaseClient<any, 'mockr', any>;

/**
 * Server-side Supabase client. It uses the same public anon key as the browser;
 * nothing in this API needs more (never the service role key).
 */
export function createDb(url: string, anonKey: string): Db {
  return createClient<any, 'mockr'>(url, anonKey, {
    db: { schema: 'mockr' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
