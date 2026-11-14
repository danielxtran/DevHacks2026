import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { PostCard, PostCardSkeleton } from '../components/PostCard';
import { sortHot } from '../lib/hot';
import { errorText, supabase, supabaseConfigured } from '../lib/supabase';
import { FLAIRS, SORTS, type Comment, type Flair, type Post, type Sort } from '../types';

const PAGE = 25;
const HOT_POOL = 100;

async function fetchPosts(sort: Sort, flair: Flair | null, offset: number): Promise<{ rows: Post[]; more: boolean }> {
  let q = supabase.from('posts').select('*');
  if (flair) q = q.eq('flair', flair);

  if (sort === 'hot') {
    // Fetch the newest 100, rank client-side with the same formula as SQL listing().
    const { data, error } = await q.order('created_at', { ascending: false }).limit(HOT_POOL);
    if (error) throw error;
    return { rows: sortHot(data as Post[]), more: false };
  }

  q = sort === 'new'
    ? q.order('created_at', { ascending: false })
    : q.order('score', { ascending: false }).order('created_at', { ascending: false });
  // Ask for one extra row to know whether "Load more" should show.
  const { data, error } = await q.range(offset, offset + PAGE);
  if (error) throw error;
  const rows = data as Post[];
  return { rows: rows.slice(0, PAGE), more: rows.length > PAGE };
}

async function fetchCounts(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from('comments').select('post_id').in('post_id', ids);
  if (error) throw error;
  const counts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const row of data as Pick<Comment, 'post_id'>[]) counts[row.post_id] = (counts[row.post_id] ?? 0) + 1;
  return counts;
}

export default function Feed() {
  const [params, setParams] = useSearchParams();
  const sortParam = params.get('sort') as Sort | null;
  const sort: Sort = sortParam && SORTS.includes(sortParam) ? sortParam : 'hot';
  const flairParam = params.get('flair') as Flair | null;
  const flair: Flair | null = flairParam && FLAIRS.includes(flairParam) ? flairParam : null;

  const [posts, setPosts] = useState<Post[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [visible, setVisible] = useState(PAGE);       // hot: how many of the pool to show
  const [serverMore, setServerMore] = useState(false); // new/top: more rows on the server
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Post[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Initial load whenever sort / flair changes.
  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIncoming([]);
    setVisible(PAGE);
    (async () => {
      try {
        const { rows, more } = await fetchPosts(sort, flair, 0);
        if (cancelled) return;
        setPosts(rows);
        setServerMore(more);
        const c = await fetchCounts(rows.map((p) => p.id));
        if (!cancelled) setCounts(c);
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sort, flair, reloadKey]);

  // Realtime: new posts and comment counts.
  useEffect(() => {
    if (!supabaseConfigured) return;
    const channel = supabase
      .channel(`feed-${sort}-${flair ?? 'all'}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'mockreddit', table: 'posts' }, (payload) => {
        const p = payload.new as Post;
        if (flair && p.flair !== flair) return;
        if (sort === 'new') {
          setPosts((prev) => (prev.some((x) => x.id === p.id) ? prev : [p, ...prev]));
          setCounts((c) => ({ ...c, [p.id]: c[p.id] ?? 0 }));
        } else {
          setIncoming((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'mockreddit', table: 'comments' }, (payload) => {
        const c = payload.new as Comment;
        setCounts((m) => (c.post_id in m ? { ...m, [c.post_id]: m[c.post_id] + 1 } : m));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [sort, flair]);

  async function loadMore() {
    if (sort === 'hot') { setVisible((v) => v + PAGE); return; }
    setLoadingMore(true);
    try {
      const { rows, more } = await fetchPosts(sort, flair, posts.length);
      const fresh = rows.filter((r) => !posts.some((p) => p.id === r.id));
      setPosts((prev) => [...prev, ...fresh]);
      setServerMore(more);
      const c = await fetchCounts(fresh.map((p) => p.id));
      setCounts((prev) => ({ ...prev, ...c }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  }

  function setParam(key: 'sort' | 'flair', value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }

  const shown = sort === 'hot' ? posts.slice(0, visible) : posts;
  const hasMore = sort === 'hot' ? posts.length > visible : serverMore;

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
        <nav className="flex gap-1" aria-label="Sort posts">
          {SORTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setParam('sort', s === 'hot' ? null : s)}
              aria-current={sort === s ? 'page' : undefined}
              className={`rounded-full px-3 py-1 text-sm font-semibold capitalize ${sort === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {s}
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap gap-1.5" aria-label="Filter by flair">
          {[null, ...FLAIRS].map((f) => (
            <button
              key={f ?? 'all'}
              type="button"
              onClick={() => setParam('flair', f)}
              aria-pressed={flair === f}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${flair === f ? 'border-accent bg-accent-light text-accent-dark' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {f ?? 'All'}
            </button>
          ))}
        </div>
      </div>

      {incoming.length > 0 && (
        <div className="sticky top-16 z-20 flex justify-center">
          <button
            type="button"
            onClick={() => { setIncoming([]); reload(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow-md hover:bg-accent-dark"
          >
            ↑ {incoming.length} new {incoming.length === 1 ? 'post' : 'posts'}
          </button>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={reload} />}

      {loading ? (
        Array.from({ length: 4 }, (_, i) => <PostCardSkeleton key={i} />)
      ) : shown.length === 0 && !error ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          <p className="font-semibold">No posts yet</p>
          {flair && <p className="mt-1 text-sm">Nothing flaired <b>{flair}</b>. <Link to="?" className="text-accent-dark underline">Show all</Link></p>}
        </div>
      ) : (
        shown.map((p) => <PostCard key={p.id} post={p} commentCount={counts[p.id]} />)
      )}

      {!loading && hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="rounded-full border border-slate-300 bg-white px-5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
