import type { Post } from '../types';

/** Add a post to a list unless it's already there. */
export function addUnique(list: Post[], p: Post, where: 'start' | 'end' = 'end'): Post[] {
  if (list.some((x) => x.id === p.id)) return list;
  return where === 'start' ? [p, ...list] : [...list, p];
}

/** Apply a realtime UPDATE (new counts) to a post already in the list. */
export function patchPost(list: Post[], updated: Post): Post[] {
  return list.some((x) => x.id === updated.id)
    ? list.map((x) => (x.id === updated.id ? { ...x, ...updated } : x))
    : list;
}
