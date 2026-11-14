import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BODY_MAX, COMMUNITY, TITLE_MAX, postPath } from '../config';
import { errorText, supabase } from '../lib/supabase';
import { FLAIRS, type Flair, type Post } from '../types';

export function CreatePostModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [flair, setFlair] = useState<Flair>('Discussion');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = title.trim();
  const b = body.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!t) return setError('Title is required.');
    if (t.length > TITLE_MAX) return setError(`Title must be ${TITLE_MAX} characters or fewer (currently ${t.length}).`);
    if (b.length > BODY_MAX) return setError(`Body must be ${BODY_MAX} characters or fewer (currently ${b.length}).`);
    setSending(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('submit_post', { p_title: t, p_body: b, p_flair: flair });
    setSending(false);
    if (err) return setError(errorText(err));
    onClose();
    navigate(postPath((data as Post).id));
  }

  const counter = (n: number, max: number) => (
    <span className={`text-xs tabular-nums ${n > max ? 'font-semibold text-red-600' : 'text-slate-400'}`}>{n}/{max}</span>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:pt-20"
      onMouseDown={() => { if (!sending) onClose(); }}
    >
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-post-title"
        className="w-full max-w-xl space-y-4 rounded-xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="create-post-title" className="text-lg font-bold">Create a post in r/{COMMUNITY}</h2>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100">✕</button>
        </div>

        <label className="block space-y-1">
          <div className="flex justify-between text-sm font-medium">
            <span>Title <span className="text-red-500">*</span></span>
            {counter(t.length, TITLE_MAX)}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            className="w-full rounded-md border border-slate-300 p-2 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <label className="block space-y-1">
          <div className="flex justify-between text-sm font-medium">
            <span>Body <span className="font-normal text-slate-400">(optional)</span></span>
            {counter(b.length, BODY_MAX)}
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full resize-y rounded-md border border-slate-300 p-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Flair</span>
          <select
            value={flair}
            onChange={(e) => setFlair(e.target.value as Flair)}
            className="block w-full rounded-md border border-slate-300 bg-white p-2 text-sm focus:border-accent focus:outline-none sm:w-48"
          >
            {FLAIRS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>

        {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={sending} className="rounded-full px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" disabled={sending} className="rounded-full bg-accent px-5 py-1.5 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-50">
            {sending ? 'Posting…' : 'Post'}
          </button>
        </div>
        <p className="text-xs text-slate-400">You&rsquo;ll post under a random anonymous name.</p>
      </form>
    </div>
  );
}
