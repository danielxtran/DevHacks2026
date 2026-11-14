import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False when .env.local is missing; the layout shows a setup banner instead of crashing. */
export const supabaseConfigured = Boolean(url && key);

// ALL queries + RPCs target the mockreddit schema. Never touch `public` from this app.
export const supabase = createClient<any, 'mockreddit'>(
  url || 'http://localhost:54321',
  key || 'missing-anon-key',
  { db: { schema: 'mockreddit' } },
);

/** Turn a Supabase/network error into something worth showing a person. */
export function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    if (/failed to fetch|networkerror|load failed/i.test(err.message)) {
      return "Can't reach the server. Check your connection and the Supabase URL.";
    }
    return err.message;
  }
  return 'Something went wrong.';
}
