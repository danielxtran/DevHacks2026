import { Link, useLocation } from 'react-router-dom';
import { postPath } from '../config';
import { relativeTime } from '../lib/time';
import type { Post } from '../types';
import { FlairChip } from './FlairChip';
import { VoteColumn } from './VoteColumn';

const PREVIEW = 200;

export function PostCard({ post, commentCount }: { post: Post; commentCount?: number }) {
  const preview = post.body.length > PREVIEW ? `${post.body.slice(0, PREVIEW).trimEnd()}…` : post.body;
  // Remember the feed's ?sort=&flair= so the post page's back link returns to the same view.
  const { search } = useLocation();
  const linkState = { feedSearch: search };
  return (
    <article className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300">
      <VoteColumn kind="post" id={post.id} score={post.score} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <FlairChip flair={post.flair} />
          <span>u/{post.author} · {relativeTime(post.created_at)}</span>
        </div>
        <h2 className="break-words text-lg font-semibold leading-snug">
          <Link to={postPath(post.id)} state={linkState} className="hover:text-accent-dark">{post.title}</Link>
        </h2>
        {preview && <p className="mt-1 line-clamp-3 break-words text-sm text-slate-600">{preview}</p>}
        <Link to={postPath(post.id)} state={linkState} className="mt-2 inline-block rounded px-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
          💬 {commentCount ?? '…'} {commentCount === 1 ? 'comment' : 'comments'}
        </Link>
      </div>
    </article>
  );
}

export function PostCardSkeleton() {
  return (
    <div className="flex animate-pulse gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="h-16 w-6 rounded bg-slate-200" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-32 rounded bg-slate-200" />
        <div className="h-5 w-3/4 rounded bg-slate-200" />
        <div className="h-3 w-full rounded bg-slate-100" />
        <div className="h-3 w-2/3 rounded bg-slate-100" />
      </div>
    </div>
  );
}
