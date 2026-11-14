import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { postPath } from '../config';
import { hasAction, setAction, type ActionKind } from '../lib/storage';
import { errorText, supabase } from '../lib/supabase';
import { useToast } from '../lib/toast';
import type { Post } from '../types';
import { HeartIcon, ReplyIcon, RepostIcon } from './Icons';

/** Optimistic like / repost toggles. Second click sends -1. */
function useToggle(kind: ActionKind, id: string, count: number) {
  const toast = useToast();
  const [on, setOn] = useState(() => hasAction(kind, id));
  const [shown, setShown] = useState(count);
  const [busy, setBusy] = useState(false);
  useEffect(() => setShown(count), [count]);

  async function toggle() {
    if (busy) return;
    const next = !on;
    const prevShown = shown;
    setOn(next);
    setShown(Math.max(0, prevShown + (next ? 1 : -1)));
    setAction(kind, id, next);
    setBusy(true);
    const { data, error } = await supabase.rpc(kind, { p_id: id, p_delta: next ? 1 : -1 });
    setBusy(false);
    if (error) {
      setOn(!next);
      setShown(prevShown);
      setAction(kind, id, !next);
      toast(`${kind === 'like' ? 'Like' : 'Repost'} failed: ${errorText(error)}`);
    } else {
      setShown(data as number);
    }
  }
  return { on, shown, toggle };
}

export function ActionRow({ post, large = false }: { post: Post; large?: boolean }) {
  const like = useToggle('like', post.id, post.like_count);
  const repost = useToggle('repost', post.id, post.repost_count);
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  const btn = 'group flex items-center gap-1.5 rounded-full text-sm tabular-nums transition-colors';

  return (
    <div className={`flex items-center ${large ? 'justify-around border-y border-slate-100 py-2' : 'max-w-md justify-between pt-2'} text-slate-500`}>
      <Link to={postPath(post.id)} onClick={(e) => e.stopPropagation()} aria-label={`${post.reply_count} replies`} className={`${btn} hover:text-accent`}>
        <span className="rounded-full p-1.5 group-hover:bg-accent-light"><ReplyIcon /></span>
        {post.reply_count}
      </Link>
      <button
        type="button"
        onClick={(e) => { stop(e); void repost.toggle(); }}
        aria-pressed={repost.on}
        aria-label={repost.on ? 'Undo repost' : 'Repost'}
        className={`${btn} ${repost.on ? 'text-repost' : 'hover:text-repost'}`}
      >
        <span className="rounded-full p-1.5 group-hover:bg-emerald-50"><RepostIcon /></span>
        {repost.shown}
      </button>
      <button
        type="button"
        onClick={(e) => { stop(e); void like.toggle(); }}
        aria-pressed={like.on}
        aria-label={like.on ? 'Unlike' : 'Like'}
        className={`${btn} ${like.on ? 'text-accent' : 'hover:text-accent'}`}
      >
        <span className="rounded-full p-1.5 group-hover:bg-accent-light"><HeartIcon filled={like.on} /></span>
        {like.shown}
      </button>
    </div>
  );
}
