import { useEffect, useState } from 'react';
import { errorText, supabase } from '../lib/supabase';
import { useToast } from '../lib/toast';
import { getVote, setVote, type VoteValue } from '../lib/votes';

interface Props {
  kind: 'post' | 'comment';
  id: string;
  score: number;
  horizontal?: boolean;
}

/**
 * Optimistic voting. Clicking the same arrow again undoes the vote; switching
 * direction sends two ±1 calls (the RPC only accepts 1 or -1).
 */
export function VoteColumn({ kind, id, score, horizontal = false }: Props) {
  const key = `${kind}:${id}`;
  const toast = useToast();
  const [mine, setMine] = useState<VoteValue>(() => getVote(key));
  const [shown, setShown] = useState(score);
  const [busy, setBusy] = useState(false);

  useEffect(() => setShown(score), [score]);

  async function click(dir: 1 | -1) {
    if (busy) return;
    const target: VoteValue = mine === dir ? 0 : dir;
    const delta = target - mine;
    const prevMine = mine;
    const prevShown = shown;

    setMine(target);
    setShown(prevShown + delta);
    setVote(key, target);
    setBusy(true);
    try {
      const step = delta > 0 ? 1 : -1;
      let latest: number | null = null;
      for (let i = 0; i < Math.abs(delta); i++) {
        const { data, error } = await supabase.rpc('vote', { p_kind: kind, p_id: id, p_delta: step });
        if (error) throw error;
        latest = data as number;
      }
      if (latest !== null) setShown(latest);
    } catch (err) {
      setMine(prevMine);
      setShown(prevShown);
      setVote(key, prevMine);
      toast(`Vote failed: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const arrow = (dir: 1 | -1) => {
    const active = mine === dir;
    const color = active ? (dir === 1 ? 'text-accent' : 'text-down') : 'text-slate-400 hover:text-slate-700';
    return (
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void click(dir); }}
        aria-label={dir === 1 ? 'Upvote' : 'Downvote'}
        aria-pressed={active}
        className={`rounded p-1 leading-none transition-colors hover:bg-slate-100 ${color}`}
      >
        {dir === 1 ? '▲' : '▼'}
      </button>
    );
  };

  const scoreColor = mine === 1 ? 'text-accent' : mine === -1 ? 'text-down' : 'text-slate-800';
  return (
    <div className={`flex items-center ${horizontal ? 'flex-row gap-1' : 'flex-col gap-0.5'} text-sm`}>
      {arrow(1)}
      <span className={`min-w-[2ch] text-center font-bold tabular-nums ${scoreColor}`}>{shown}</span>
      {arrow(-1)}
    </div>
  );
}
