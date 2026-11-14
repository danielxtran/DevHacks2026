import { useCallback, useEffect, useState } from 'react';
import { Composer } from '../components/Composer';
import { PostCard, PostCardSkeleton } from '../components/PostCard';
import { EmptyState, ErrorBanner, PageHeader } from '../components/ui';
import { addUnique, patchPost } from '../lib/patch';
import { errorText, supabase, supabaseConfigured } from '../lib/supabase';
import type { Post } from '../types';

const PAGE = 20;

async function fetchTimeline(from: number): Promise<{ rows: Post[]; more: boolean }> {
  // Ask for one extra row to know whether "Show more" should appear.
  const { data, error } = await supabase
    .from('posts').select('*')
    .is('reply_to_id', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + PAGE);
  if (error) throw error;
  const rows = data as Post[];
  return { rows: rows.slice(0, PAGE), more: rows.length > PAGE };
}

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTimeline(0)
      .then(({ rows, more }) => { if (!cancelled) { setPosts(rows); setHasMore(more); setIncoming([]); } })
      .catch((err) => { if (!cancelled) setError(errorText(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Realtime: new root posts → "Show N new posts" pill (no scroll jump); updates → live counts.
  useEffect(() => {
    if (!supabaseConfigured) return;
    const channel = supabase
      .channel(`home-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'mockr', table: 'posts' }, (payload) => {
        const p = payload.new as Post;
        if (p.reply_to_id === null) setIncoming((prev) => (prev.includes(p.id) ? prev : [...prev, p.id]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'mockr', table: 'posts' }, (payload) => {
        setPosts((prev) => patchPost(prev, payload.new as Post));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const onPosted = useCallback((p: Post) => setPosts((prev) => addUnique(prev, p, 'start')), []);

  async function showMore() {
    setLoadingMore(true);
    try {
      const { rows, more } = await fetchTimeline(posts.length);
      setPosts((prev) => rows.reduce((acc, r) => addUnique(acc, r), prev));
      setHasMore(more);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  }

  // Your own posts arrive over realtime too; they're already shown, so don't count them.
  const newCount = incoming.filter((id) => !posts.some((p) => p.id === id)).length;

  return (
    <>
      <PageHeader title="Home" />
      <div className="border-b border-slate-100 px-4 pt-2">
        <Composer onPosted={onPosted} />
      </div>

      {newCount > 0 && (
        <button
          type="button"
          onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setReloadKey((k) => k + 1); }}
          className="w-full border-b border-slate-100 py-3 text-sm font-medium text-accent hover:bg-slate-50"
        >
          Show {newCount} new {newCount === 1 ? 'post' : 'posts'}
        </button>
      )}

      {error && <ErrorBanner message={error} onRetry={() => setReloadKey((k) => k + 1)} />}

      {loading ? (
        Array.from({ length: 5 }, (_, i) => <PostCardSkeleton key={i} />)
      ) : posts.length === 0 && !error ? (
        <EmptyState title="Nothing here yet">Be the first to post.</EmptyState>
      ) : (
        posts.map((p) => <PostCard key={p.id} post={p} />)
      )}

      {!loading && hasMore && (
        <button
          type="button"
          onClick={() => void showMore()}
          disabled={loadingMore}
          className="w-full py-4 text-sm font-medium text-accent hover:bg-slate-50 disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
    </>
  );
}
