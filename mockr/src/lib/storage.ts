// Per-browser sets of post ids you've liked / reposted: localStorage 'r:likes', 'r:reposts'.
// Storage can be unavailable (private mode, blocked cookies), so every access is guarded.
export type ActionKind = 'like' | 'repost';
const KEYS: Record<ActionKind, string> = { like: 'r:likes', repost: 'r:reposts' };

function read(kind: ActionKind): Set<string> {
  try {
    const raw = localStorage.getItem(KEYS[kind]);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function hasAction(kind: ActionKind, id: string): boolean {
  return read(kind).has(id);
}

export function setAction(kind: ActionKind, id: string, on: boolean): void {
  try {
    const set = read(kind);
    if (on) set.add(id); else set.delete(id);
    localStorage.setItem(KEYS[kind], JSON.stringify([...set]));
  } catch {
    /* storage unavailable: state just won't be remembered */
  }
}
