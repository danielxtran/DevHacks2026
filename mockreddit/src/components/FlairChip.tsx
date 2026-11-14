import type { Flair } from '../types';

const STYLES: Record<Flair, string> = {
  Balance: 'bg-amber-100 text-amber-800',
  Discussion: 'bg-sky-100 text-sky-800',
  Meme: 'bg-fuchsia-100 text-fuchsia-800',
  Clip: 'bg-emerald-100 text-emerald-800',
  Question: 'bg-violet-100 text-violet-800',
};

export function FlairChip({ flair }: { flair: Flair }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STYLES[flair] ?? 'bg-slate-100 text-slate-700'}`}>
      {flair}
    </span>
  );
}
