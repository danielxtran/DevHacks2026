import { useEffect, useState } from 'react';
import type { Post } from '../types';
import { supabase } from './supabase';

/** For replies shown in lists: map reply_to_id → parent's author_username ("Replying to @…"). */
export function useParentAuthors(posts: Post[]): Record<string, string> {
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const missing = [...new Set(posts.map((p) => p.reply_to_id).filter((id): id is string => !!id && !(id in authors)))];
  const key = missing.sort().join(',');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    supabase.from('posts').select('id, author_username').in('id', key.split(',')).then(({ data }) => {
      if (cancelled || !data) return;
      setAuthors((prev) => ({ ...prev, ...Object.fromEntries(data.map((r) => [r.id as string, r.author_username as string])) }));
    });
    return () => { cancelled = true; };
  }, [key]);

  return authors;
}
