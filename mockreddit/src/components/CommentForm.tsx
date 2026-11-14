import { useState, type FormEvent } from 'react';
import { BODY_MAX } from '../config';
import { errorText, supabase } from '../lib/supabase';
import type { Comment } from '../types';

interface Props {
  postId: string;
  parentId?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  onCreated: (c: Comment) => void;
  onCancel?: () => void;
}

export function CommentForm({ postId, parentId = null, placeholder = 'Add a comment', autoFocus, onCreated, onCancel }: Props) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = body.trim();
  const tooLong = trimmed.length > BODY_MAX;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed) return setError('Comment can’t be empty.');
    if (tooLong) return setError(`Comment must be ${BODY_MAX} characters or fewer.`);
    setSending(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('submit_comment', {
      p_post_id: postId, p_body: trimmed, p_parent_id: parentId,
    });
    setSending(false);
    if (err) return setError(errorText(err));
    setBody('');
    onCreated(data as Comment);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={parentId ? 2 : 3}
        className="w-full resize-y rounded-md border border-slate-300 p-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs tabular-nums ${tooLong ? 'font-semibold text-red-600' : 'text-slate-400'}`}>
          {trimmed.length}/{BODY_MAX}
        </span>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="rounded-full px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
          )}
          <button type="submit" disabled={sending} className="rounded-full bg-accent px-4 py-1 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-50">
            {sending ? 'Posting…' : parentId ? 'Reply' : 'Comment'}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
