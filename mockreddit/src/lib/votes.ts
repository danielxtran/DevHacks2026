// Per-browser vote memory: localStorage 'forumly:votes' → { "post:s001": 1, "comment:c004": -1 }
// Storage can be unavailable (private mode, blocked cookies), so every access is guarded.
const KEY = 'forumly:votes';
export type VoteValue = -1 | 0 | 1;

function readAll(): Record<string, VoteValue> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, VoteValue>) : {};
  } catch {
    return {};
  }
}

export function getVote(key: string): VoteValue {
  const v = readAll()[key];
  return v === 1 || v === -1 ? v : 0;
}

export function setVote(key: string, value: VoteValue): void {
  try {
    const all = readAll();
    if (value === 0) delete all[key];
    else all[key] = value;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: votes just won't be remembered */
  }
}
