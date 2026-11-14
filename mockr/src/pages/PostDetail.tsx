import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ActionRow } from '../components/ActionRow';
import { Avatar } from '../components/Avatar';
import { Composer } from '../components/Composer';
import { PostCard } from '../components/PostCard';
import { RichText } from '../components/RichText';
import { EmptyState, ErrorBanner, PageHeader } from '../components/ui';
import { userPath } from '../config';
import { addUnique, patchPost } from '../lib/patch';
import { errorText, supabase, supabaseConfigured } from '../lib/supabase';
import { fullTimestamp } from '../lib/time';
import type { Post } from '../types';

export default function PostDetail() {
  const { id = '' } = useParams();
  const [thread, setThread] = useState<Post[]>([]);   // every post in the conversation (incl. the focused one)
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    (async () => {
      const one = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
      if (cancelled) return;
      if (one.error) { setError(errorText(one.error)); setLoading(false); return; }
      if (!one.data) { setNotFound(true); setLoading(false); return; }
      const post = one.data as Post;
      const conv = await supabase.from('posts').select('*').eq('conversation_id', post.conversation_id).order('created_at');
      if (cancelled) return;
      if (conv.error) setError(errorText(conv.error));
      else setThread(addUnique(conv.data as Post[], post));
      setLoading(false);
    })();
    window.scrollTo({ top: 0 });
    return () => { cancelled = true; };
  }, [id, reloadKey]);

  const focused = thread.find((p) => p.id === id) ?? null;
  const conversationId = focused?.conversation_id;

  // Realtime: new replies anywhere in this conversation, plus live counts.
  useEffect(() => {
    if (!supabaseConfigured || !conversationId) return;
    const filter = `conversation_id=eq.${conversationId}`;
    const channel = supabase
      .channel(`thread-${conversationId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'mockr', table: 'posts', filter },
        (payload) => setThread((prev) => addUnique(prev, payload.new as Post)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'mockr', table: 'posts', filter },
        (payload) => setThread((prev) => patchPost(prev, payload.new as Post)))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId]);

  const { ancestors, replies } = useMemo(() => {
    if (!focused) return { ancestors: [] as Post[], replies: [] as Post[] };
    const byId = new Map(thread.map((p) => [p.id, p]));
    const ancestors: Post[] = [];
    let cur = focused.reply_to_id;
    while (cur && byId.has(cur) && ancestors.length < 100) {
      const parent = byId.get(cur)!;
      ancestors.unshift(parent);
      cur = parent.reply_to_id;
    }
    const replies = thread
      .filter((p) => p.reply_to_id === focused.id)
      .sort((a, b) => b.like_count - a.like_count || a.created_at.localeCompare(b.created_at));
    return { ancestors, replies };
  }, [thread, focused]);

  const onReplied = useCallback((p: Post) => {
    setThread((prev) => addUnique(prev, p).map((x) => (x.id === p.reply_to_id ? { ...x, reply_count: x.reply_count + 1 } : x)));
  }, []);

  return (
    <>
      <PageHeader title="Post" back />
      {loading ? (
        <div className="animate-pulse space-y-3 p-4">
          <div className="flex items-center gap-3"><div className="h-12 w-12 rounded-full bg-slate-200" /><div className="h-4 w-40 rounded bg-slate-200" /></div>
          <div className="h-5 w-full rounded bg-slate-100" /><div className="h-5 w-2/3 rounded bg-slate-100" />
        </div>
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : notFound || !focused ? (
        <EmptyState title="This post doesn’t exist">Try searching for something else.</EmptyState>
      ) : (
        <>
          {ancestors.map((p) => <PostCard key={p.id} post={p} ancestor />)}

          <article className="px-4 pt-3">
            <div className="flex items-center gap-3">
              <Link to={userPath(focused.author_username)}><Avatar name={focused.author_name} username={focused.author_username} size="md" /></Link>
              <div className="min-w-0">
                <Link to={userPath(focused.author_username)} className="block truncate font-bold hover:underline">{focused.author_name}</Link>
                <Link to={userPath(focused.author_username)} className="block truncate text-sm text-slate-500">@{focused.author_username}</Link>
              </div>
            </div>
            {ancestors.length > 0 && (
              <p className="mt-3 text-sm text-slate-500">
                Replying to <Link to={userPath(ancestors[ancestors.length - 1].author_username)} className="text-accent hover:underline">@{ancestors[ancestors.length - 1].author_username}</Link>
              </p>
            )}
            <RichText body={focused.body} className="mt-3 text-[22px] leading-snug" />
            <p className="mt-3 text-[15px] text-slate-500">{fullTimestamp(focused.created_at)}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 py-3 text-[15px]">
              <span><b className="tabular-nums">{focused.reply_count}</b> <span className="text-slate-500">{focused.reply_count === 1 ? 'Reply' : 'Replies'}</span></span>
              <span><b className="tabular-nums">{focused.repost_count}</b> <span className="text-slate-500">{focused.repost_count === 1 ? 'Repost' : 'Reposts'}</span></span>
              <span><b className="tabular-nums">{focused.like_count}</b> <span className="text-slate-500">{focused.like_count === 1 ? 'Like' : 'Likes'}</span></span>
            </div>
            <ActionRow post={focused} large />
          </article>

          <div className="border-b border-slate-100 px-4 pt-1">
            <Composer key={focused.id} replyToId={focused.id} placeholder="Post your reply" submitLabel="Reply" onPosted={onReplied} />
          </div>

          {replies.map((p) => <PostCard key={p.id} post={p} />)}
          {replies.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No replies yet.</p>}
        </>
      )}
    </>
  );
}
