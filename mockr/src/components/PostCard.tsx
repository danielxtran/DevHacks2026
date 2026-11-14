import { Link, useNavigate } from 'react-router-dom';
import { postPath, userPath } from '../config';
import { fullTimestamp, relativeTime } from '../lib/time';
import type { Post } from '../types';
import { ActionRow } from './ActionRow';
import { Avatar } from './Avatar';
import { RichText } from './RichText';

interface Props {
  post: Post;
  /** Parent's username, for "Replying to @…" on replies shown in lists. */
  replyingTo?: string;
  /** Muted style + connecting line, for the parent chain on the thread page. */
  ancestor?: boolean;
}

export function PostCard({ post, replyingTo, ancestor = false }: Props) {
  const navigate = useNavigate();

  function open(e: React.MouseEvent) {
    // Let links/buttons inside the card handle their own clicks, and don't hijack text selection.
    if ((e.target as HTMLElement).closest('a,button')) return;
    if (window.getSelection()?.toString()) return;
    navigate(postPath(post.id));
  }

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <article
      onClick={open}
      className={`flex cursor-pointer gap-3 px-4 pt-3 transition-colors hover:bg-slate-50 ${ancestor ? 'opacity-80' : 'border-b border-slate-100 pb-2'}`}
    >
      <div className="flex flex-col items-center">
        <Link to={userPath(post.author_username)} onClick={stop} aria-label={`${post.author_name}'s profile`}>
          <Avatar name={post.author_name} username={post.author_username} />
        </Link>
        {ancestor && <div className="mt-1 w-0.5 flex-1 bg-slate-200" aria-hidden="true" />}
      </div>
      <div className={`min-w-0 flex-1 ${ancestor ? 'pb-3' : ''}`}>
        <div className="flex min-w-0 items-baseline gap-1 text-[15px]">
          <Link to={userPath(post.author_username)} onClick={stop} className="truncate font-bold hover:underline">{post.author_name}</Link>
          <Link to={userPath(post.author_username)} onClick={stop} className="truncate text-slate-500">@{post.author_username}</Link>
          <span className="text-slate-500">·</span>
          <Link to={postPath(post.id)} onClick={stop} title={fullTimestamp(post.created_at)} className="shrink-0 text-slate-500 hover:underline">
            {relativeTime(post.created_at)}
          </Link>
        </div>
        {replyingTo && (
          <p className="text-sm text-slate-500">
            Replying to <Link to={userPath(replyingTo)} onClick={stop} className="text-accent hover:underline">@{replyingTo}</Link>
          </p>
        )}
        <RichText body={post.body} className="text-[15px] leading-snug" />
        <ActionRow post={post} />
      </div>
    </article>
  );
}

export function PostCardSkeleton() {
  return (
    <div className="flex animate-pulse gap-3 border-b border-slate-100 px-4 py-3">
      <div className="h-10 w-10 rounded-full bg-slate-200" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-40 rounded bg-slate-200" />
        <div className="h-3 w-full rounded bg-slate-100" />
        <div className="h-3 w-2/3 rounded bg-slate-100" />
      </div>
    </div>
  );
}
