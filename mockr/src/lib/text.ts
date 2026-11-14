// Text helpers. User text is NEVER parsed as HTML: bodies are split into plain
// strings and #tag / @mention tokens, which the UI renders as React <Link>s.

/** Postgres char_length counts code points; JS .length counts UTF-16 units (emoji = 2). */
export const charCount = (s: string) => Array.from(s).length;

export type Segment =
  | { type: 'text'; value: string }
  | { type: 'hashtag'; value: string; tag: string }
  | { type: 'mention'; value: string; username: string };

// A token must start the string or follow a non-word char, so 'a@b.com' isn't a mention.
const TOKEN = /(?<![\w])([#@])([A-Za-z0-9_]+)/g;

export function segments(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ type: 'text', value: body.slice(last, start) });
    out.push(m[1] === '#'
      ? { type: 'hashtag', value: m[0], tag: m[2] }
      : { type: 'mention', value: m[0], username: m[2] });
    last = start + m[0].length;
  }
  if (last < body.length) out.push({ type: 'text', value: body.slice(last) });
  return out;
}

/** Top hashtags (case-insensitive) across the given bodies. */
export function topHashtags(bodies: string[], n = 5): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const body of bodies) {
    for (const s of segments(body)) {
      if (s.type !== 'hashtag') continue;
      const key = s.tag.toLowerCase();
      const entry = counts.get(key) ?? { tag: s.tag, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, n);
}

/** Escape LIKE wildcards so a search for '100%' or 'a_b' matches literally. */
export const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);
