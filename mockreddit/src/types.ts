// Hand-written to match supabase/migrations/0002_mockreddit.sql exactly.
export type Flair = 'Balance' | 'Discussion' | 'Meme' | 'Clip' | 'Question';
export const FLAIRS: Flair[] = ['Balance', 'Discussion', 'Meme', 'Clip', 'Question'];

export interface Post {
  id: string; title: string; body: string; author: string; flair: Flair;
  score: number; is_seed: boolean; created_at: string;
}
export interface Comment {
  id: string; post_id: string; parent_id: string | null; author: string;
  body: string; score: number; is_seed: boolean; created_at: string;
}

export type Sort = 'hot' | 'new' | 'top';
export const SORTS: Sort[] = ['hot', 'new', 'top'];
