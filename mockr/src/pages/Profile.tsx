import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { PostCard, PostCardSkeleton } from '../components/PostCard';
import { EmptyState, ErrorBanner, PageHeader } from '../components/ui';
import { errorText, supabase, supabaseConfigured } from '../lib/supabase';
import { monthYear } from '../lib/time';
import { useParentAuthors } from '../lib/useParentAuthors';
import type { Post } from '../types';

export default function Profile() {
  const { username = '' } = useParams();
  const [params] = useSearchParams();
  const tab = params.get('tab') === 'replies' ? 'replies' : 'posts';
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase.from('posts').select('*').eq('author_username', username).order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(errorText(err)); else setPosts(data as Post[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [username, reloadKey]);

  const roots = posts.filter((p) => !p.reply_to_id);
  const replies = posts.filter((p) => p.reply_to_id);
  const shown = tab === 'posts' ? roots : replies;
  const parentAuthors = useParentAuthors(tab === 'replies' ? replies : []);

  const displayName = posts[0]?.author_name ?? username;
  const joined = posts.length ? posts[posts.length - 1].created_at : null;
  const isGuest = username.startsWith('guest_');

  const tabClass = (active: boolean) =>
    `flex-1 py-3 text-center text-[15px] hover:bg-slate-50 ${active ? 'font-bold text-slate-900' : 'text-slate-500'}`;

  return (
    <>
      <PageHeader title={displayName} subtitle={`${posts.length} ${posts.length === 1 ? 'post' : 'posts'}`} back />
      <div className="h-32 bg-gradient-to-r from-accent to-fuchsia-500" />
      <div className="px-4 pb-3">
        <div className="-mt-10 rounded-full border-4 border-white bg-white" style={{ width: 'fit-content' }}>
          <Avatar name={displayName} username={username} size="lg" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="break-all text-xl font-extrabold">{displayName}</h2>
          {isGuest && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Guest</span>}
        </div>
        <p className="break-all text-slate-500">@{username}</p>
        <p className="mt-2 text-sm text-slate-500">
          {joined ? <>Joined {monthYear(joined)} · </> : null}
          <b className="text-slate-900">{posts.length}</b> {posts.length === 1 ? 'post' : 'posts'}
        </p>
      </div>

      <nav className="flex border-b border-slate-100" aria-label="Profile tabs">
        <Link to="?" replace className={tabClass(tab === 'posts')} aria-current={tab === 'posts' ? 'page' : undefined}>Posts</Link>
        <Link to="?tab=replies" replace className={tabClass(tab === 'replies')} aria-current={tab === 'replies' ? 'page' : undefined}>Replies</Link>
      </nav>

      {error && <ErrorBanner message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {loading ? (
        Array.from({ length: 3 }, (_, i) => <PostCardSkeleton key={i} />)
      ) : shown.length === 0 && !error ? (
        <EmptyState title={`@${username} hasn’t ${tab === 'posts' ? 'posted' : 'replied to anything'} yet`}>
          {posts.length === 0 ? 'When they do, it’ll show up here.' : null}
        </EmptyState>
      ) : (
        shown.map((p) => <PostCard key={p.id} post={p} replyingTo={p.reply_to_id ? parentAuthors[p.reply_to_id] : undefined} />)
      )}
    </>
  );
}
