import { useState, type FormEvent } from 'react';
import { PageHeader } from '../components/ui';
import { errorText, supabase } from '../lib/supabase';

/** Dev-only: shows exactly what the pipeline receives from search_recent(). */
export default function DebugSearch() {
  const [q, setQ] = useState('');
  const [json, setJson] = useState('Press Fetch.');
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(token: string | null) {
    setBusy(true);
    const { data, error } = await supabase.rpc('search_recent', {
      p_query: q.trim() || null, p_max_results: 100, p_next_token: token,
    });
    setBusy(false);
    if (error) { setJson(`Error: ${errorText(error)}`); setNextToken(null); return; }
    setJson(JSON.stringify(data, null, 2));
    setNextToken((data as { meta?: { next_token?: string } })?.meta?.next_token ?? null);
  }

  function submit(e: FormEvent) { e.preventDefault(); void run(null); }

  return (
    <>
      <PageHeader title="search_recent" subtitle="Raw pipeline JSON (dev only)" />
      <form onSubmit={submit} className="flex flex-wrap gap-2 p-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="query (blank = everything)" className="min-w-0 flex-1 rounded-full border border-slate-300 px-4 py-1.5 font-mono text-sm focus:border-accent focus:outline-none" />
        <button type="submit" disabled={busy} className="rounded-full bg-accent px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50">Fetch</button>
        <button type="button" disabled={busy || !nextToken} onClick={() => void run(nextToken)} className="rounded-full border border-slate-300 px-4 py-1.5 text-sm font-bold disabled:opacity-40">
          Next page
        </button>
      </form>
      <pre className="mx-4 mb-4 max-h-[75vh] overflow-auto rounded-xl bg-slate-900 p-4 text-xs leading-relaxed text-violet-200">{json}</pre>
    </>
  );
}
