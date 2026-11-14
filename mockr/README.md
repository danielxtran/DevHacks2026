# R (mock microblog)

A small standalone React app that imitates a microblog. It is a **mock outside data source** for Patchwork: the agent pipeline pulls player feedback from it as if it were a real website, and judges can post into it live during the demo.

All data lives in the `mockr` schema in Supabase (`supabase/migrations/0004_mockr.sql`). This app never touches the `public` or `mockreddit` schemas.

## Setup (hosted Supabase)

Put the hosted project's `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the repository-root `.env`; both Vite apps load this shared file. Apply migrations `0001`–`0006` from the repository's `supabase/migrations/` directory to the hosted project in numeric order, then expose `public`, `graphql_public`, `mockreddit`, and `mockr` in its API settings. Migration `0004_mockr.sql` depends on `public.feedback_posts` created by `0001`.

The Vite anon key is public. Never put a service-role key or database password in the frontend environment.

Run this app:

```bash
npm install
npm run dev      # http://localhost:5175
npm run build    # type-check + production build
```

## Routes

| Route | Page |
|---|---|
| `/` | Home timeline (root posts only) + composer |
| `/post/:id` | Post with its parent chain, reply composer and direct replies |
| `/u/:username` | Profile: Posts / Replies tabs |
| `/search?q=` | Search (`#tags` work) |
| `/_debug/search` | **Dev only.** Raw JSON from `search_recent`, with paging: exactly what the pipeline receives |

## Backend API (RPCs in the `mockr` schema)

Direct inserts and updates are blocked by RLS. All writes go through these RPCs:

| RPC | Args | Returns |
|---|---|---|
| `submit_post` | `p_body`, `p_reply_to_id` (null = new post) | the new post. The server assigns `Guest XXXX @guest_xxxxxx`. |
| `like` | `p_id`, `p_delta` (`1`\|`-1`) | the new like count (never below 0) |
| `repost` | `p_id`, `p_delta` (`1`\|`-1`) | the new repost count |
| `search_recent` | `p_query` (substring, null = all), `p_max_results` (10–100), `p_next_token` | X API v2-shaped JSON: `data`, `includes.users`, `meta.next_token`. **Pipeline only.** |

Server-side limits: posts 1–280 characters, 20 posts/minute globally.

`src/sources/fetchR.ts` is a reference fetcher that pages through `search_recent` (up to 500 posts) and maps each one to a `feedback_posts` row (`id: 'r_<id>'`, `source: 'r'`, `fixture_set: 'mock-live'`), parents before replies. It doesn't write to the database; the worker does.

## Notes

- User text is rendered as plain React text. Only `#hashtags` and `@mentions` become links, and their contents stay plain text, so pasted `<script>` or prompt-injection payloads display harmlessly.
- Likes and reposts are remembered per browser in `localStorage` (`r:likes`, `r:reposts`). The database doesn't track who liked what; this is a mock.
- Rename the app in `src/config.ts`.
- Remove everything typed live (keeps the seed posts): `delete from mockr.posts where not is_seed;`
