import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { POST_MAX, POST_WARN } from '../config';
import { charCount } from '../lib/text';
import { errorText, supabase } from '../lib/supabase';
import type { Post } from '../types';

interface Props {
  replyToId?: string | null;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  onPosted: (p: Post) => void;
}

export interface ComposerHandle { focus: () => void }

/** Circular progress counter: amber from 260, red past 280 (then shows how far over). */
function Counter({ n }: { n: number }) {
  if (n === 0) return null;
  const r = 9;
  const c = 2 * Math.PI * r;
  const frac = Math.min(n / POST_MAX, 1);
  const color = n > POST_MAX ? '#dc2626' : n >= POST_WARN ? '#d97706' : '#7c3aed';
  const remaining = POST_MAX - n;
  return (
    <div className="flex items-center gap-1.5" aria-label={`${n} of ${POST_MAX} characters`}>
      {n >= POST_WARN && (
        <span className={`text-xs tabular-nums ${n > POST_MAX ? 'font-semibold text-red-600' : 'text-amber-600'}`}>{remaining}</span>
      )}
      <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90" aria-hidden="true">
        <circle cx="12" cy="12" r={r} fill="none" stroke="#e2e8f0" strokeWidth="2.5" />
        <circle cx="12" cy="12" r={r} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} strokeLinecap="round" />
      </svg>
    </div>
  );
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { replyToId = null, placeholder = "What's happening?", submitLabel = 'Post', autoFocus, onPosted },
  ref,
) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }), []);

  const trimmed = text.trim();
  const n = charCount(trimmed);
  const disabled = sending || n === 0 || n > POST_MAX;

  // Auto-grow the textarea to fit its content.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (n === 0) return setError('Post can’t be empty.');
    if (n > POST_MAX) return setError(`Posts are limited to ${POST_MAX} characters (this one is ${n}).`);
    setSending(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('submit_post', { p_body: trimmed, p_reply_to_id: replyToId });
    setSending(false);
    if (err) return setError(errorText(err));
    setText('');
    onPosted(data as Post);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        ref={area}
        value={text}
        onChange={(e) => { setText(e.target.value); if (error) setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(e); }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={replyToId ? 1 : 2}
        className="block w-full resize-none overflow-hidden bg-transparent py-2 text-lg placeholder:text-slate-400 focus:outline-none"
      />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-2">
        <Counter n={n} />
        <button type="submit" disabled={disabled} className="rounded-full bg-accent px-4 py-1.5 text-sm font-bold text-white hover:bg-accent-dark disabled:opacity-50">
          {sending ? 'Posting…' : submitLabel}
        </button>
      </div>
    </form>
  );
});
