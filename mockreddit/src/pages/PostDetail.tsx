import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CommentForm } from '../components/CommentForm';
import { ErrorBanner } from '../components/ErrorBanner';
import { FlairChip } from '../components/FlairChip';
import { VoteColumn } from '../components/VoteColumn';
import { COMMUNITY, FEED_PATH } from '../config';
import { errorText, supabase, supabaseConfigured } from '../lib/supabase';
import { relativeTime } from '../lib/time';
import type { Comment, Post } from '../types';

function addUnique(list: Comment[], c: Comment): Comment[] {
  return list.some((x) => x.id === c.id) ? list : [...list, c];
}

export default function PostDetail() {
  const { id = '' } = useParams();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    (async () => {
      const [p, c] = await Promise.all([
        supabase.from('posts').select('*').eq('id', id).maybeSingle(),
        supabase.from('comments').select('*').eq('post_id', id).order('created_at'),
      ]);
      if (cancelled) return;
      if (p.error || c.error) setError(errorText(p.error ?? c.error));
      else if (!p.data) setNotFound(true);
      else { setPost(p.data as Post); setComments(c.data as Comment[]); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, reloadKey]);

  useEffect(() => {
    if (!supabaseConfigured || !id) return;
    const channel = supabase
      .channel(`post-${id}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'mockreddit', table: 'comments', filter: `post_id=eq.${id}` },
        (payload) => setComments((prev) => addUnique(prev, payload.new as Comment)))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [id]);

  const onCreated = useCallback((c: Comment) => {
    setComments((prev) => addUnique(prev, c));
    setReplyingTo(null);
  }, []);

  const { topLevel, replies } = useMemo(() => {
    const topLevel = comments
      .filter((c) => !c.parent_id)
      .sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at));
    const replies = new Map<string, Comment[]>();
    for (const c of comments) {
      if (!c.parent_id) continue;
      replies.set(c.parent_id, [...(replies.get(c.parent_id) ?? []), c]);
    }
    return { topLevel, replies };
  }, [comments]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="h-3 w-40 rounded bg-slate-200" />
        <div className="h-6 w-3/4 rounded bg-slate-200" />
        <div className="h-3 w-full rounded bg-slate-100" />
        <div className="h-3 w-5/6 rounded bg-slate-100" />
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (notFound || !post) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
        <p className="font-semibold">Post not found</p>
        <Link to={FEED_PATH} className="mt-2 inline-block text-sm text-accent-dark underline">Back to r/{COMMUNITY}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Link to={FEED_PATH} className="inline-block text-sm font-medium text-slate-500 hover:text-slate-800">← r/{COMMUNITY}</Link>

      <article className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <VoteColumn kind="post" id={post.id} score={post.score} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <FlairChip flair={post.flair} />
            <span>u/{post.author} · {relativeTime(post.created_at)}</span>
          </div>
          <h1 className="break-words text-xl font-bold leading-snug">{post.title}</h1>
          {post.body && <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800">{post.body}</p>}
        </div>
      </article>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <CommentForm postId={post.id} onCreated={onCreated} />
        <h2 className="border-t border-slate-100 pt-3 text-sm font-semibold text-slate-600">
          {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
        </h2>

        {topLevel.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No comments yet. Be the first.</p>
        ) : (
          <ul className="space-y-4">
            {topLevel.map((c) => (
              <li key={c.id}>
                <CommentItem comment={c} onReply={() => setReplyingTo(replyingTo === c.id ? null : c.id)} />
                {replyingTo === c.id && (
                  <div className="ml-6 mt-2 border-l-2 border-slate-200 pl-4">
                    <CommentForm
                      postId={post.id}
                      parentId={c.id}
                      placeholder={`Reply to u/${c.author}`}
                      autoFocus
                      onCreated={onCreated}
                      onCancel={() => setReplyingTo(null)}
                    />
                  </div>
                )}
                {(replies.get(c.id) ?? []).length > 0 && (
                  <ul className="ml-6 mt-3 space-y-3 border-l-2 border-slate-200 pl-4">
                    {(replies.get(c.id) ?? []).map((r) => (
                      <li key={r.id}><CommentItem comment={r} /></li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** onReply is only passed for top-level comments: replies are one level deep. */
function CommentItem({ comment, onReply }: { comment: Comment; onReply?: () => void }) {
  return (
    <div>
      <div className="text-xs text-slate-500">
        <span className="font-semibold text-slate-700">u/{comment.author}</span> · {relativeTime(comment.created_at)}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{comment.body}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <VoteColumn kind="comment" id={comment.id} score={comment.score} horizontal />
        {onReply && (
          <button type="button" onClick={onReply} className="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100">
            Reply
          </button>
        )}
      </div>
    </div>
  );
}
