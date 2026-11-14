import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// All reads go to the mockreddit schema. Never touch `public` from this app.
export type Db = SupabaseClient<any, 'mockreddit', any>;

/**
 * Server-side Supabase client. It uses the same public anon key as the browser;
 * nothing in this API needs more (never the service role key).
 */
export function createDb(url: string, anonKey: string): Db {
  return createClient<any, 'mockreddit'>(url, anonKey, {
    db: { schema: 'mockreddit' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
