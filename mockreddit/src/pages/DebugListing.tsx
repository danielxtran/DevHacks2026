import { useEffect, useState } from 'react';
import { errorText, supabase } from '../lib/supabase';

/** Dev-only: shows exactly what the pipeline receives from listing('new', 25). */
export default function DebugListing() {
  const [json, setJson] = useState<string>('Loading…');

  useEffect(() => {
    supabase.rpc('listing', { p_sort: 'new', p_limit: 25, p_after: null }).then(({ data, error }) => {
      setJson(error ? `Error: ${errorText(error)}` : JSON.stringify(data, null, 2));
    });
  }, []);

  return (
    <div className="space-y-2">
      <h1 className="font-mono text-sm font-semibold text-slate-600">rpc listing(&apos;new&apos;, 25)</h1>
      <pre className="max-h-[75vh] overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-emerald-200">{json}</pre>
    </div>
  );
}
