# Riotdit · r/PatchworkTFT (mock subreddit)

A small standalone React app that imitates a subreddit. It is a **mock outside data source** for Patchwork: the agent pipeline pulls player feedback from it as if it were a real website, and judges can post into it live during the demo.

All data lives in the `mockreddit` schema in Supabase (`supabase/migrations/0002_mockreddit.sql`). This app never touches the `public` schema.

## Setup (hosted Supabase)

Put the hosted project's `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the repository-root `.env`; both Vite apps load this shared file. Apply the migrations in `supabase/migrations/` as described in the [migration guide](../supabase/migrations/README.md) (never replay `0001`–`0004` on the shared hosted project), then expose `public`, `graphql_public`, `mockreddit`, and `mockr` in its API settings. Migration `0004_mockr.sql` depends on `public.feedback_posts` created by `0001`.

The Vite anon key is public. Never put a service-role key or database password in the frontend environment.

Run this app:

```bash
npm install
npm run dev      # web on http://localhost:5174 + API server on :4174 (API paths proxied through 5174)
npm run dev:web  # web only
npm run dev:api  # API server only
npm test         # API tests (Supabase mocked)
npm run build    # type-check web + server, production build
npm start        # production: one process serves the API and dist/ on $PORT (default 4174)
```

## Public JSON API

`server/` is a small Express app that exposes Reddit-shaped endpoints. The agent pipeline reads Riotdit **only through these endpoints**, using nothing but the site's URL:

- `/r/PatchworkTFT/{new,hot,top}.json`
- `/r/PatchworkTFT/comments/:id.json`
- `/r/PatchworkTFT/about.json`
- `/api/health`

Full docs, field mapping and a reference fetcher are in [API.md](API.md). The same docs, plus a "Try it" box, are in the app at `/dev/api`.

The server reads `SUPABASE_URL` and `SUPABASE_ANON_KEY`, falling back to the `VITE_` names; it's the same public anon key. It refuses to start with a service-role or secret key.

## Routes

| Route | Page |
|---|---|
| `/r/PatchworkTFT` | Feed (`?sort=hot\|new\|top`, `?flair=Balance`) |
| `/r/PatchworkTFT/post/:id` | Post + comments |
| `/dev/api` | Developer docs for the public JSON API, with a "Try it" box |
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
