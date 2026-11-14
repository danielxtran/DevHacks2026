// Reference implementation for the collector (P3): pages through the
// Reddit-shaped listing() RPC and returns flat posts + comments.
// Copy it into the worker; there, use a client created with { db: { schema: 'mockreddit' } }.
import { supabase } from '../lib/supabase';

export interface ListingComment {
  id: string;
  name: string;            // 't1_<id>'
  parent_id: string;       // 't3_<post id>' for top level, 't1_<comment id>' for replies
  author: string;
  body: string;
  score: number;
  created_utc: number;     // unix seconds
}

export interface ListingPost {
  id: string;
  name: string;            // 't3_<id>'
  title: string;
  selftext: string;
  author: string;
  score: number;
  link_flair_text: string;
  created_utc: number;
  num_comments: number;
  permalink: string;
  subreddit: string;
  comments: ListingComment[];
}

interface Listing {
  kind: 'Listing';
  data: { after: string | null; dist: number; children: { kind: 't3'; data: ListingPost }[] };
}

/** Pages through the Reddit-shaped listing RPC and returns flat posts + comments. */
export async function fetchAllPosts(sort: 'new' | 'hot' | 'top' = 'new', max = 200) {
  const posts: ListingPost[] = [];
  let after: string | null = null;

  while (posts.length < max) {
    const { data, error } = await supabase.rpc('listing', {
      p_sort: sort,
      p_limit: Math.min(100, max - posts.length),
      p_after: after,
    });
    if (error) throw error;
    const listing = data as Listing;
    for (const child of listing.data.children) posts.push(child.data);
    after = listing.data.after;
    if (!after) break;
  }

  const comments = posts.flatMap((p) => p.comments.map((c) => ({ ...c, post_id: p.id })));
  return { posts, comments };
}
