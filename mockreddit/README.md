# Riotdit · r/PatchworkTFT (mock subreddit)

A small standalone React app that imitates a subreddit. It is a **mock outside data source** for Patchwork: the agent pipeline pulls player feedback from it as if it were a real website, and judges can post into it live during the demo.

All data lives in the `mockreddit` schema in Supabase (`supabase/migrations/0002_mockreddit.sql`). This app never touches the `public` schema.

## Setup (hosted Supabase)

Put the hosted project's `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the repository-root `.env`; both Vite apps load this shared file. Apply migrations `0001`–`0006` from the repository's `supabase/migrations/` directory to the hosted project in numeric order, then expose `public`, `graphql_public`, `mockreddit`, and `mockr` in its API settings. Migration `0004_mockr.sql` depends on `public.feedback_posts` created by `0001`.

The Vite anon key is public. Never put a service-role key or database password in the frontend environment.

Run this app:

```bash
npm install
npm run dev      # http://localhost:5174
npm run build    # type-check + production build
```

## Routes

| Route | Page |
|---|---|
| `/r/PatchworkTFT` | Feed (`?sort=hot\|new\|top`, `?flair=Balance`) |
| `/r/PatchworkTFT/post/:id` | Post + comments |
| `/_debug/listing` | **Dev only.** Raw JSON from `listing('new', 25)`: exactly what the pipeline receives |

## Backend API (RPCs in the `mockreddit` schema)

Direct inserts and updates are blocked by RLS. All writes go through these RPCs:

| RPC | Args | Returns |
|---|---|---|
| `submit_post` | `p_title`, `p_body`, `p_flair` | the new post (server assigns `anon_xxxxxx` as the author) |
| `submit_comment` | `p_post_id`, `p_body`, `p_parent_id` (null = top level; replies are one level deep) | the new comment |
| `vote` | `p_kind` (`post`\|`comment`), `p_id`, `p_delta` (`1`\|`-1`) | the new score |
| `listing` | `p_sort` (`new`\|`hot`\|`top`), `p_limit` (1–100), `p_after` (`t3_<id>`) | Reddit-shaped JSON with comments inlined. **Pipeline only.** |

Server-side limits: title 1–300 chars, body ≤ 2000, 20 posts/min and 40 comments/min globally.

`src/sources/fetchListing.ts` is a reference fetcher that pages through `listing` and returns flat `{ posts, comments }`, ready for the collector to copy.

## Notes

- User text is always rendered as plain React text (no HTML, no markdown), so pasted `<script>` or prompt-injection payloads display harmlessly.
- Votes are remembered per browser in `localStorage` (`riotdit:votes`). The database doesn't track voters; this is a mock.
- Rename the site or community in `src/config.ts`.
