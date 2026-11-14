import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SearchIcon } from '../components/Icons';
import { PostCard, PostCardSkeleton } from '../components/PostCard';
import { EmptyState, ErrorBanner, PageHeader } from '../components/ui';
import { errorText, supabase, supabaseConfigured } from '../lib/supabase';
import { escapeLike } from '../lib/text';
import { useParentAuthors } from '../lib/useParentAuthors';
import type { Post } from '../types';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const [input, setInput] = useState(q);
  const [results, setResults] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => setInput(q), [q]);

  useEffect(() => {
    if (!supabaseConfigured || !q) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase.from('posts').select('*')
      .ilike('body', `%${escapeLike(q)}%`)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(errorText(err)); else setResults(data as Post[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [q, reloadKey]);

  const parentAuthors = useParentAuthors(results);

  function submit(e: FormEvent) {
    e.preventDefault();
    const next = input.trim();
    setParams(next ? { q: next } : {});
  }

  return (
    <>
      <PageHeader title="Search">
        <form onSubmit={submit} role="search" className="px-4 pb-3">
          <label className="flex items-center gap-3 rounded-full bg-slate-100 px-4 py-2.5 text-slate-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-accent">
            <SearchIcon className="h-5 w-5" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search posts, #tags"
              autoFocus={!q}
              className="w-full bg-transparent text-slate-900 focus:outline-none"
            />
          </label>
        </form>
      </PageHeader>

      {error && <ErrorBanner message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {!q ? (
        <EmptyState title="Search R">Try a #hashtag or a unit name like “sniper”.</EmptyState>
      ) : loading ? (
        Array.from({ length: 3 }, (_, i) => <PostCardSkeleton key={i} />)
      ) : results.length === 0 && !error ? (
        <EmptyState title={`No results for “${q}”`}>Try a different word or hashtag.</EmptyState>
      ) : (
        results.map((p) => <PostCard key={p.id} post={p} replyingTo={p.reply_to_id ? parentAuthors[p.reply_to_id] : undefined} />)
      )}
    </>
  );
}
