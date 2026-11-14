// Hand-written to match supabase/migrations/0004_mockr.sql exactly.
export interface Post {
  id: string;                 // numeric string, e.g. "1850000000000000001"
  author_username: string;    // handle without '@'
  author_name: string;        // display name
  body: string;               // ≤ 280 chars
  reply_to_id: string | null; // set = this post is a reply
  conversation_id: string;    // id of the thread's root post
  like_count: number;
  repost_count: number;
  reply_count: number;        // direct replies only
  is_seed: boolean;
  created_at: string;
}
