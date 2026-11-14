# Riotdit public API (Reddit-shaped)

Riotdit serves its own read-only JSON API, shaped like Reddit's `.json` endpoints. The pipeline should pull r/PatchworkTFT **only through this API**; it doesn't need Supabase credentials or any knowledge of the database.

| | Base URL |
|---|---|
| Local | `http://localhost:5174` (run `npm run dev` in `mockreddit/`) |
| Production | wherever `npm start` is deployed (the site and the API share one URL) |

There's no auth. Please send a descriptive `User-Agent`, e.g. `patchwork-collector/1.0`. It's logged, but not required.

Interactive docs with a "Try it" box: `<base>/dev/api`.

## Endpoints

Only `PatchworkTFT` exists, and the name is case-insensitive. Any other subreddit returns 404.

| Endpoint | Returns |
|---|---|
| `GET /r/PatchworkTFT/new.json` | Listing, newest first |
| `GET /r/PatchworkTFT/hot.json` | Listing, ranked by `score / (age_hours + 2)^1.5` |
| `GET /r/PatchworkTFT/top.json` | Listing, highest score first |
| `GET /r/PatchworkTFT/comments/:id.json` | `[postListing, commentsListing]` |
| `GET /r/PatchworkTFT/about.json` | Subreddit info (`t5`) |
| `GET /api/health` | `{ ok, service, time }`, or 503 when the data store is unreachable |

### Listings: `new.json`, `hot.json`, `top.json`

| Param | Rule |
|---|---|
| `limit` | Integer 1–100. Default 25. |
| `after` | Optional. `t3_<id>`: the previous page's `data.after`. |

Unknown params are ignored.

```bash
curl -A "patchwork-collector/1.0" "http://localhost:5174/r/PatchworkTFT/new.json?limit=2"
```

```jsonc
{
  "kind": "Listing",
  "data": {
    "after": "t3_s002",            // null on the last page
    "dist": 2,
    "children": [
      {
        "kind": "t3",
        "data": {
          "id": "s001",
          "name": "t3_s001",
          "title": "Brawler A is literally unkillable with 4 Ironclad",
          "selftext": "I put my whole board into it and it just shields and keeps going…",
          "author": "anon_tft1",
          "score": 412,
          "link_flair_text": "Balance",
          "created_utc": 1762790400,   // unix seconds
          "num_comments": 2,
          "permalink": "/r/PatchworkTFT/post/s001",
          "subreddit": "PatchworkTFT",
          "comments": [                // every comment on the post, flat, oldest first
            {
              "id": "c001", "name": "t1_c001",
              "parent_id": "t3_s001",   // t3_<post> = top level, t1_<comment> = reply
              "author": "rollingdown", "body": "BA never dies, the shield just resets every fight", "score": 210,
              "created_utc": 1762794000
            }
          ]
        }
      }
      // …
    ]
  }
}
```

Listings include **every comment inline** under `data.comments`. A full crawl only needs the listing endpoint; you don't need to call `comments/:id.json` per post.

### Pagination

Pass `data.after` back as `?after=` until it's `null`:

```
new.json?limit=100                 → after: "t3_k3j9a1x"
new.json?limit=100&after=t3_k3j9a1x → after: "t3_b8c0d2e"
…                                  → after: null   (done)
```

- Use **`new`** for full crawls. The cursor is a post id, so posts created mid-crawl don't shift later pages. `hot` and `top` can reorder while scores change.
- If the post count is an exact multiple of `limit`, the last full page still has an `after`, and the next page is empty with `after: null`.
- Stop if a cursor repeats. If the `after` post is deleted mid-crawl, the API starts again from the first page.

### Post and comment tree: `comments/:id.json`

```bash
curl -A "patchwork-collector/1.0" "http://localhost:5174/r/PatchworkTFT/comments/s001.json"
```

```jsonc
[
  { "kind": "Listing", "data": { "after": null, "dist": 1, "children": [
      { "kind": "t3", "data": { "id": "s001", "name": "t3_s001", "title": "…", "selftext": "…", "…": "same fields as a listing child" } }
  ] } },
  { "kind": "Listing", "data": { "after": null, "dist": 1, "children": [   // top-level comments, score desc
      { "kind": "t1", "data": {
          "id": "c001", "name": "t1_c001", "parent_id": "t3_s001", "link_id": "t3_s001",
          "author": "rollingdown", "body": "BA never dies…", "score": 210, "created_utc": 1762794000,
          "replies": { "kind": "Listing", "data": { "after": null, "dist": 1, "children": [
              { "kind": "t1", "data": { "id": "c002", "name": "t1_c002", "parent_id": "t1_c001", "…": "…", "replies": "" } }
          ] } }
      } },
      // a comment with no replies has "replies": "" (Reddit does this too)
  ] } }
]
```

An unknown post id returns 404.

### `about.json`

```jsonc
{ "kind": "t5", "data": {
    "display_name": "PatchworkTFT", "display_name_prefixed": "r/PatchworkTFT",
    "title": "Riotdit · r/PatchworkTFT", "public_description": "Discussion for Patchwork TFT: balance, comps, clips.",
    "subscribers": 10,          // = number of posts
    "created_utc": 1762500000,  // oldest post
    "url": "/r/PatchworkTFT/" } }
```

## Errors and rate limits

Errors always have the shape `{ "message": "...", "error": <status> }`.

| Status | When |
|---|---|
| 400 | Invalid param. The message names it, e.g. `Invalid query parameter "limit": must be an integer from 1 to 100`. |
| 404 | Unknown subreddit, post, sort or path. |
| 429 | Rate limit exceeded. |
| 502 | The data store failed. Retry later. |
| 503 | `/api/health` only: the data store is unreachable. |
| 500 | Anything else. |

**Rate limit:** 60 requests per minute per IP, in fixed 60-second windows. Every response has these headers:

- `X-Ratelimit-Used`: requests used this window
- `X-Ratelimit-Remaining`: requests left this window
- `X-Ratelimit-Reset`: seconds until the window resets

A 429 also has `Retry-After`. Responses are `Cache-Control: no-store`, so posts typed live appear on the next request.

## Mapping into `feedback_posts`

| `feedback_posts` | Post (`t3` data) | Comment (`data.comments[]`) |
|---|---|---|
| `id` | `'mr_' + id` | `'mr_' + id` |
| `external_id` | `name` (`t3_…`) | `name` (`t1_…`) |
| `source` | `'reddit'` | `'reddit'` |
| `fixture_set` | `'mock-live'` | `'mock-live'` |
| `kind` | `'post'` | `'comment'` |
| `title` | `title` | `null` |
| `body` | `selftext` | `body` |
| `score` | `score` | `score` |
| `posted_at` | `created_utc` → ISO timestamp | `created_utc` → ISO timestamp |
| `parent_id` | `null` | `'mr_' + parent_id` without its `t3_`/`t1_` prefix |
| `thread_id` | `null` | `'mr_' + post id` |

Insert posts before comments, and parent comments before their replies, because `parent_id` and `thread_id` are foreign keys.

Post ids and comment ids come from separate tables, so the shared `mr_` prefix could collide in theory. The ids are random 7-character hex, so a collision is very unlikely at demo scale.

## Reference fetcher

```ts
export interface FeedbackRow {
  id: string;
  external_id: string;
  source: 'reddit';
  fixture_set: 'mock-live';
  kind: 'post' | 'comment';
  parent_id: string | null;
  thread_id: string | null;
  title: string | null;
  body: string;
  score: number;
  posted_at: string;
}

const iso = (unix: number) => new Date(unix * 1000).toISOString();
const strip = (fullname: string) => fullname.replace(/^t[13]_/, '');

/** Pages /new.json until `after` is null. Returns posts first, then comments (parents before replies). */
export async function fetchAllForumly(baseUrl: string): Promise<FeedbackRow[]> {
  const posts: FeedbackRow[] = [];
  const comments: FeedbackRow[] = [];
  const seen = new Set<string>();
  let after: string | null = null;

  do {
    const url = new URL('/r/PatchworkTFT/new.json', baseUrl);
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);

    const res = await fetch(url, { headers: { 'User-Agent': 'patchwork-collector/1.0' } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get('Retry-After')) || 5) * 1000));
      continue; // retry the same page
    }
    if (!res.ok) throw new Error(`Riotdit API ${res.status}: ${(await res.json()).message}`);

    const page = await res.json();
    for (const { data: p } of page.data.children) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      const rootId = `mr_${p.id}`;
      posts.push({
        id: rootId, external_id: p.name, source: 'reddit', fixture_set: 'mock-live', kind: 'post',
        parent_id: null, thread_id: null, title: p.title, body: p.selftext, score: p.score, posted_at: iso(p.created_utc),
      });
      // Comments arrive oldest first, so a parent always comes before its replies.
      for (const c of p.comments) {
        comments.push({
          id: `mr_${c.id}`, external_id: c.name, source: 'reddit', fixture_set: 'mock-live', kind: 'comment',
          parent_id: `mr_${strip(c.parent_id)}`, thread_id: rootId, title: null, body: c.body, score: c.score,
          posted_at: iso(c.created_utc),
        });
      }
    }

    const next: string | null = page.data.after;
    if (next && next === after) throw new Error(`Riotdit API repeated cursor ${next}`);
    after = next;
  } while (after);

  return [...posts, ...comments];
}
```

## Running it

```bash
cd mockreddit
npm install
npm run dev        # web on :5174 + API on :4174; API paths are proxied, so use :5174 for everything
npm test           # API tests (Supabase mocked)
npm run build      # type-check web + server, build dist/
npm start          # production: one process serves the API and dist/ on $PORT (default 4174)
```

The server reads `SUPABASE_URL` and `SUPABASE_ANON_KEY`, falling back to `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. It looks for them in `mockreddit/.env.local`, `mockreddit/.env`, `../.env.local` and `../.env`. That's the same public anon key the browser uses. The server refuses to start with a service-role or secret key.
