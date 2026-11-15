# R developer API (X API v2-shaped)

R serves its own read-only developer API, shaped like the X API v2. The pipeline should pull R posts **only through this API**, using nothing but R's URL. It doesn't need Supabase credentials or any knowledge of the database.

| | Base URL |
|---|---|
| Local | `http://localhost:5175` (run `npm run dev` in `mockr/`) |
| Production | wherever `npm start` is deployed (the site and the API share one URL) |

Interactive docs with a "Try it" console: `<base>/developers`.

## Auth

None. Every endpoint is public: no keys or tokens. If a client sends an `Authorization` header, it's ignored and never logged.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /2/tweets/search/recent` | Posts matching `query`, newest first, paged |
| `GET /2/tweets/:id` | One post |
| `GET /2/tweets?ids=1,2,3` | Up to 100 posts by id |
| `GET /api/health` | `{ ok, service: "r", time }`, or 503 when the data store is unreachable |

Every post has the same fields on every endpoint:

```jsonc
{
  "id": "1850000000000010079",
  "text": "ahri and jinx backline has zero survivability 😤",
  "author_id": "anon_nnzz0",                 // = username
  "created_at": "2026-11-10T07:53:30.123Z",  // ISO, ms, Z
  "conversation_id": "1850000000000010079",  // root post of the thread
  "public_metrics": { "like_count": 15, "retweet_count": 1, "reply_count": 3, "quote_count": 0 },
  "referenced_tweets": []                    // or [{ "type": "replied_to", "id": "<parent id>" }]
}
```

Users in `includes.users` look like `{ "id": "anon_nnzz0", "username": "anon_nnzz0", "name": "Anon NNZ" }`.

### `GET /2/tweets/search/recent`

| Param | Rule |
|---|---|
| `query` | **Required**, 1–512 characters. See query syntax below. |
| `max_results` | Integer 10–100. Default 10. |
| `next_token` | Optional. The previous page's `meta.next_token`. |
| `tweet.fields`, `expansions`, `user.fields` | Accepted and ignored. Responses always include `created_at`, `public_metrics`, `conversation_id`, `referenced_tweets` and `includes.users`; that's the subset we support. |

**Query syntax:** a deliberately small subset of X's. The whole query is exactly one of these:

| Query | Matches |
|---|---|
| `sniper`, `jinx range` | Posts containing that text (case-insensitive substring) |
| `#TFT` | The same, for a hashtag. URL-encode `#` as `%23`. |
| `*` | Everything |
| `conversation_id:<id>` | Every post in that thread: the root and all replies |
| `from:<username>` | That user's posts and replies |

Boolean operators, quotes and combining operators aren't supported.

```bash
curl \
  "http://localhost:5175/2/tweets/search/recent?query=%23TFT&max_results=100"
```

```jsonc
{
  "data": [ { "id": "1850000000000011799", "text": "…#TFT", "author_id": "gg_z4n38z", "…": "…" } /* … */ ],
  "includes": { "users": [ { "id": "gg_z4n38z", "username": "gg_z4n38z", "name": "Gg Z4N" } /* … */ ] },
  "meta": {
    "result_count": 100,
    "newest_id": "1850000000000011799",
    "oldest_id": "1850000000000010412",
    "next_token": "1850000000000010412"   // only present when the page is full
  }
}
```

No matches returns `{ "meta": { "result_count": 0 } }`, with no `data` and no `includes`, the same as X.

### Pagination

Pass `meta.next_token` back as `?next_token=` until it's **absent**:

```
search/recent?query=*&max_results=100                         → meta.next_token: "185…412"
search/recent?query=*&max_results=100&next_token=185…412      → meta.next_token: "185…077"
…                                                             → no next_token   (done)
```

- **Stable pages:** the cursor is keyset-based, on (created_at, id). Posts created mid-crawl don't shift later pages; they show up on the next fresh crawl.
- **Exact multiples:** if the result count is an exact multiple of `max_results`, the last full page still has a `next_token`, and the next page returns `{ meta: { result_count: 0 } }`.
- **Bad tokens:** an unknown `next_token` returns 400.

### Threads

```bash
curl \
  "http://localhost:5175/2/tweets/search/recent?query=conversation_id:1850000000000010079&max_results=100"
```

This returns the root and every reply, newest first, in the same shape as above. Rebuild the tree with `referenced_tweets[0].id`.

### `GET /2/tweets/:id` and `GET /2/tweets?ids=`

```bash
curl "http://localhost:5175/2/tweets/1850000000000010079"
curl "http://localhost:5175/2/tweets?ids=1850000000000010079,1850000000000010080,1"
```

```jsonc
// /2/tweets/:id
{ "data": { "id": "1850000000000010079", "…": "…" }, "includes": { "users": [ { "…": "…" } ] } }

// /2/tweets?ids=  (found posts in the order asked, plus an errors entry per missing id)
{
  "data": [ { "id": "1850000000000010079", "…": "…" }, { "id": "1850000000000010080", "…": "…" } ],
  "includes": { "users": [ /* … */ ] },
  "errors": [ {
    "value": "1", "detail": "Could not find tweet with id: [1].", "title": "Not Found Error",
    "resource_type": "tweet", "parameter": "id", "resource_id": "1", "type": "about:blank"
  } ]
}
```

- **Unknown ids:** a missing id returns **200** with only `errors`, like X.
- **Limits:** `ids` takes 1–100 numeric ids.

## Errors and rate limits

All errors use the same shape: `{ "title": "...", "type": "about:blank", "status": <code>, "detail": "..." }`.

| Status | When |
|---|---|
| 400 | Invalid params. `detail` names the param, e.g. `Invalid "max_results" parameter: must be an integer from 10 to 100`. |
| 404 | Unknown route |
| 429 | Rate limit exceeded |
| 502 | The data store failed. Retry later. |
| 500 | Anything else |

**Rate limit:** 180 requests per 15 minutes **per IP**, in fixed windows. Every `/2/*` response has:

- `x-rate-limit-limit`: requests allowed per window
- `x-rate-limit-remaining`: requests left this window
- `x-rate-limit-reset`: when the window resets, as **unix seconds**

A 429 also has `Retry-After` (seconds). Responses are `Cache-Control: no-store`, so posts typed live show up on the next request.

## Mapping into `feedback_posts`

| `feedback_posts` | From a tweet |
|---|---|
| `id` | `'r_' + id` |
| `external_id` | `id` |
| `source` | `'r'` |
| `fixture_set` | `'mock-live'` |
| `kind` | `referenced_tweets.length ? 'comment' : 'post'` |
| `parent_id` | `'r_' + referenced_tweets[0].id` (replies), else `null` |
| `thread_id` | `'r_' + conversation_id` (replies only), else `null` |
| `title` | `null` |
| `body` | `text` |
| `score` | `public_metrics.like_count` |
| `author` | `author_id` |
| `posted_at` | `created_at` |

Insert parents before replies, because `parent_id` and `thread_id` are foreign keys. A reply whose parent wasn't fetched (for example, a narrow `query`) needs its parent fetched with `/2/tweets?ids=` first, or it has to be skipped.

## Reference fetcher

```ts
export interface FeedbackRow {
  id: string;
  external_id: string;
  source: 'r';
  fixture_set: 'mock-live';
  kind: 'post' | 'comment';
  parent_id: string | null;
  thread_id: string | null;
  title: null;
  body: string;
  score: number;
  author: string;
  posted_at: string;
}

interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  conversation_id: string;
  public_metrics: { like_count: number; retweet_count: number; reply_count: number; quote_count: number };
  referenced_tweets: { type: 'replied_to'; id: string }[];
}

/** Pages search/recent until next_token is absent. Returns mapped rows, parents before replies. */
export async function fetchAllR(baseUrl: string, query = '*'): Promise<FeedbackRow[]> {
  const tweets = new Map<string, Tweet>();
  let next: string | undefined;

  do {
    const url = new URL('/2/tweets/search/recent', baseUrl);
    url.searchParams.set('query', query);
    url.searchParams.set('max_results', '100');
    if (next) url.searchParams.set('next_token', next);

    const res = await fetch(url, { headers: { 'User-Agent': 'patchwork-collector/1.0' } });
    if (res.status === 429) {
      const reset = Number(res.headers.get('x-rate-limit-reset')) * 1000;
      await new Promise((r) => setTimeout(r, Math.max(1000, reset - Date.now())));
      continue; // retry the same page
    }
    if (!res.ok) throw new Error(`R API ${res.status}: ${(await res.json()).detail}`);

    const page: { data?: Tweet[]; meta: { next_token?: string } } = await res.json();
    for (const t of page.data ?? []) tweets.set(t.id, t);
    if (page.meta.next_token && page.meta.next_token === next) throw new Error('R API repeated next_token');
    next = page.meta.next_token;
  } while (next);

  const rows: FeedbackRow[] = [...tweets.values()].map((t) => {
    const parent = t.referenced_tweets[0]?.id;
    return {
      id: `r_${t.id}`,
      external_id: t.id,
      source: 'r',
      fixture_set: 'mock-live',
      kind: parent ? 'comment' : 'post',
      parent_id: parent ? `r_${parent}` : null,
      thread_id: parent ? `r_${t.conversation_id}` : null,
      title: null,
      body: t.text,
      score: t.public_metrics.like_count,
      author: t.author_id,
      posted_at: t.created_at,
    };
  });

  // Parents before replies: sort by depth in the reply tree, then oldest first.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depth = (r: FeedbackRow) => {
    let d = 0;
    for (let cur: FeedbackRow | undefined = r; cur?.parent_id && d < 1000; cur = byId.get(cur.parent_id)) d++;
    return d;
  };
  return rows
    .map((r) => ({ r, d: depth(r) }))
    .sort((a, b) => a.d - b.d || a.r.posted_at.localeCompare(b.r.posted_at))
    .map(({ r }) => r);
}
```

## Running it

```bash
cd mockr
npm install
npm run dev        # web on :5175 + API on :4175; /2 and /api are proxied, so use :5175 for everything
npm test           # API tests (Supabase mocked)
npm run build      # type-check web + server, build dist/
npm start          # production: one process serves the API and dist/ on $PORT (default 4175)
```

The server reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `mockr/.env.local`, `mockr/.env`, `../.env.local` or `../.env`. It falls back to the `VITE_` names, since it's the same public anon key, and refuses to start with a service-role or secret key.
