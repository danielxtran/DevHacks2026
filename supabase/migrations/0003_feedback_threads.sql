-- =====================================================================
-- 0003: let feedback_posts hold Reddit-style threads (title + comments)
--
-- Agreed minimum fields from the mock subreddit → where they go:
--   Title       → title         (null for comments / twitch / twitter)
--   Body        → body          (already existed)
--   Timestamps  → posted_at     (already existed) + fetched_at (new)
--   Upvotes     → score         (already existed)
--   Comments    → one row each, kind = 'comment', linked by parent_id / thread_id
--
-- Every comment is its own row on purpose: comments ARE feedback, so Agent 1
-- clusters them, the pre-filter can quarantine a single comment, and
-- issues.post_ids can point at a comment exactly like a post.
-- =====================================================================

alter table feedback_posts
  add column kind         text not null default 'post' check (kind in ('post', 'comment')),
  add column title        text check (char_length(title) <= 300),
  add column parent_id    text references feedback_posts (id) on delete cascade,  -- comment → the post or comment it replies to
  add column thread_id    text references feedback_posts (id) on delete cascade,  -- comment → the top-level post (for grouping)
  add column num_comments int,                                                     -- posts only, as reported by the source
  add column external_id  text,                                                    -- id on the source site, e.g. 't3_s001'
  add column fetched_at   timestamptz not null default now();

-- shape rules
alter table feedback_posts
  add constraint post_has_no_parent   check (kind <> 'post'    or (parent_id is null and thread_id is null)),
  add constraint comment_has_parent   check (kind <> 'comment' or (parent_id is not null and thread_id is not null)),
  add constraint comment_has_no_title check (kind <> 'comment' or title is null);

-- the same source item can't be imported twice into the same fixture set
create unique index feedback_posts_external_uniq
  on feedback_posts (fixture_set, source, external_id) where external_id is not null;
create index feedback_posts_thread_idx on feedback_posts (thread_id);

-- =====================================================================
-- Import convention for the collector (mock subreddit → feedback_posts)
--   id          = 'mr_' || <listing id>      e.g. 'mr_s001', 'mr_c004'
--   external_id = <listing name>             e.g. 't3_s001', 't1_c004'
--   fixture_set = 'mock-live'
--   source      = 'reddit'
-- Upsert on id so re-fetching updates scores instead of failing:
--   insert ... on conflict (id) do update set score = excluded.score,
--     num_comments = excluded.num_comments, fetched_at = now();
-- Insert posts before their comments (comments reference them).
-- =====================================================================
