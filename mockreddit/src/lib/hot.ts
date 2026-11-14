import type { Post } from '../types';

/** Same formula as the SQL listing(): score / (ageHours + 2) ^ 1.5 */
export function hotScore(p: Post, now = Date.now()): number {
  const ageHours = (now - new Date(p.created_at).getTime()) / 3_600_000;
  return p.score / Math.pow(ageHours + 2, 1.5);
}

export function sortHot(posts: Post[]): Post[] {
  const now = Date.now();
  return [...posts].sort((a, b) => hotScore(b, now) - hotScore(a, now)
    || b.created_at.localeCompare(a.created_at));
}
