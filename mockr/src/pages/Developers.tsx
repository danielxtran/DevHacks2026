import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { PageHeader } from '../components/ui';
import { APP_NAME } from '../config';

type EndpointKey = 'search' | 'tweet' | 'tweets' | 'health';

interface Endpoint {
  key: EndpointKey;
  label: string;
  path: string;
  auth: boolean;
  description: string;
}

const ENDPOINTS: Endpoint[] = [
  { key: 'search', label: 'Search recent', path: '/2/tweets/search/recent', auth: true, description: 'Posts matching a query, newest first. Paged with next_token.' },
  { key: 'tweet', label: 'Post by id', path: '/2/tweets/:id', auth: true, description: 'One post. Unknown ids return 200 with an errors array.' },
  { key: 'tweets', label: 'Posts by ids', path: '/2/tweets?ids=', auth: true, description: 'Up to 100 comma-separated ids; missing ones come back in errors.' },
  { key: 'health', label: 'Health', path: '/api/health', auth: false, description: 'Service status. Public, no token. 503 when the data store is down.' },
];

const SAMPLE_ID = '1850000000000000001';

interface Params {
  query: string;
  maxResults: string;
  nextToken: string;
  id: string;
  ids: string;
}

function buildPath(key: EndpointKey, p: Params) {
  switch (key) {
    case 'search': {
      const qs = new URLSearchParams({ query: p.query });
      if (p.maxResults.trim()) qs.set('max_results', p.maxResults.trim());
      if (p.nextToken.trim()) qs.set('next_token', p.nextToken.trim());
      return `/2/tweets/search/recent?${qs}`;
    }
    case 'tweet':
      return `/2/tweets/${encodeURIComponent(p.id.trim() || SAMPLE_ID)}`;
    case 'tweets':
      return `/2/tweets?${new URLSearchParams({ ids: p.ids.replace(/\s+/g, '') })}`;
    case 'health':
      return '/api/health';
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the text is still selectable
    }
  }
  return (
    <button type="button" onClick={copy} className="shrink-0 rounded border border-slate-600 px-2 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700">
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-slate-900 px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed text-violet-200">{children}</code>
      <CopyButton text={children} />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="space-y-3 border-b border-slate-100 px-4 py-5">
      <h2 className="text-lg font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

const mono = 'rounded bg-slate-100 px-1 font-mono text-[0.85em]';
const th = 'border-b border-slate-200 py-1.5 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';
const td = 'border-b border-slate-100 py-1.5 pr-3 align-top';

export default function Developers() {
  const base = window.location.origin;
  const curl = (key: EndpointKey) => {
    const p = buildPath(key, { query: '#TFT', maxResults: '100', nextToken: '', id: SAMPLE_ID, ids: `${SAMPLE_ID},1850000000000000101` });
    const ep = ENDPOINTS.find((e) => e.key === key)!;
    return ep.auth ? `curl -H "Authorization: Bearer $R_TOKEN" \\\n  "${base}${p}"` : `curl "${base}${p}"`;
  };

  // The token lives in component state only: never written to storage, the URL, or logs.
  const [token, setToken] = useState('');
  const [key, setKey] = useState<EndpointKey>('search');
  const [params, setParams] = useState<Params>({ query: '#TFT', maxResults: '10', nextToken: '', id: SAMPLE_ID, ids: `${SAMPLE_ID},1850000000000000101` });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: number; ms: number; headers: string; body: string; next: string | null } | null>(null);

  const ep = ENDPOINTS.find((e) => e.key === key)!;
  const path = useMemo(() => buildPath(key, params), [key, params]);
  const set = (k: keyof Params) => (e: { target: { value: string } }) => setParams((p) => ({ ...p, [k]: e.target.value }));

  async function send(p: string) {
    setBusy(true);
    const t0 = performance.now();
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (ep.auth && token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
      const res = await fetch(p, { headers });
      const text = await res.text();
      let body = text;
      let next: string | null = null;
      try {
        const json = JSON.parse(text);
        body = JSON.stringify(json, null, 2);
        next = json?.meta?.next_token ?? null;
      } catch {
        // not JSON (e.g. the API server isn't running): show raw text
      }
      const shown = ['content-type', 'x-rate-limit-limit', 'x-rate-limit-remaining', 'x-rate-limit-reset']
        .map((h) => `${h}: ${res.headers.get(h) ?? '-'}`)
        .join('\n');
      setResult({ status: res.status, ms: Math.round(performance.now() - t0), headers: shown, body, next });
    } catch {
      setResult({ status: 0, ms: Math.round(performance.now() - t0), headers: '', body: "Network error: can't reach the API.", next: null });
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void send(path);
  }

  function nextPage() {
    if (!result?.next) return;
    const p = { ...params, nextToken: result.next };
    setParams(p);
    void send(buildPath(key, p));
  }

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none';
  const label = 'flex flex-col gap-1 text-xs font-semibold text-slate-500';

  return (
    <>
      <PageHeader title="Developers" subtitle={`${APP_NAME} API v2`} />

      <div className="border-b border-slate-100 bg-gradient-to-br from-accent-light to-white px-4 py-6">
        <p className="text-xs font-bold uppercase tracking-wider text-accent-dark">Developer platform</p>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight">Build with the {APP_NAME} API</h1>
        <p className="mt-2 text-sm text-slate-600">
          Read-only access to public posts, in the same shape as the X API v2. Authenticate with an app-only bearer token.
        </p>
        <nav className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
          {[['auth', 'Auth'], ['endpoints', 'Endpoints'], ['query', 'Query syntax'], ['limits', 'Rate limits'], ['errors', 'Errors'], ['try', 'Try it']].map(([id, t]) => (
            <a key={id} href={`#${id}`} className="rounded-full border border-slate-200 bg-white px-3 py-1 hover:bg-slate-50">{t}</a>
          ))}
        </nav>
      </div>

      <Section id="base" title="Base URL">
        <Code>{base}</Code>
      </Section>

      <Section id="auth" title="Authentication">
        <p className="text-sm text-slate-700">
          Every <span className={mono}>/2/*</span> request needs an app-only bearer token in the header:
        </p>
        <Code>{'Authorization: Bearer $R_TOKEN'}</Code>
        <p className="text-sm text-slate-700">
          Tokens are issued by the {APP_NAME} team. Keep them server-side and never put one in a URL. A missing or invalid token returns <span className={mono}>401</span>.
        </p>
      </Section>

      <Section id="endpoints" title="Endpoints">
        <div className="space-y-4">
          {ENDPOINTS.map((e) => (
            <div key={e.key} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">GET</span>
                <code className="font-mono text-sm font-semibold">{e.path}</code>
                {!e.auth && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">public</span>}
              </div>
              <p className="text-sm text-slate-600">{e.description}</p>
              <Code>{curl(e.key)}</Code>
            </div>
          ))}
        </div>

        <h3 className="pt-2 font-bold">search/recent parameters</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Param</th><th className={th}>Rule</th></tr></thead>
            <tbody>
              <tr><td className={`${td} font-mono text-xs`}>query</td><td className={td}><strong>Required</strong>, 1–512 characters. See query syntax.</td></tr>
              <tr><td className={`${td} font-mono text-xs`}>max_results</td><td className={td}>Integer 10–100, default 10.</td></tr>
              <tr><td className={`${td} font-mono text-xs`}>next_token</td><td className={td}>From the previous page&apos;s <span className={mono}>meta.next_token</span>. Keep paging until it&apos;s absent.</td></tr>
              <tr>
                <td className={`${td} font-mono text-xs`}>tweet.fields, expansions, user.fields</td>
                <td className={td}>Accepted and ignored. Responses always include <span className={mono}>created_at</span>, <span className={mono}>public_metrics</span>, <span className={mono}>conversation_id</span>, <span className={mono}>referenced_tweets</span> and <span className={mono}>includes.users</span>.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="query" title="Query syntax">
        <p className="text-sm text-slate-700">A small subset of X&apos;s search operators. The whole query is one of:</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Query</th><th className={th}>Matches</th></tr></thead>
            <tbody>
              <tr><td className={`${td} font-mono text-xs`}>sniper</td><td className={td}>Posts containing the text (case-insensitive substring)</td></tr>
              <tr><td className={`${td} font-mono text-xs`}>#TFT</td><td className={td}>Same, for a hashtag. URL-encode <span className={mono}>#</span> as <span className={mono}>%23</span>.</td></tr>
              <tr><td className={`${td} font-mono text-xs`}>*</td><td className={td}>Everything</td></tr>
              <tr><td className={`${td} font-mono text-xs`}>conversation_id:&lt;id&gt;</td><td className={td}>Every post in a thread (the root and all replies)</td></tr>
              <tr><td className={`${td} font-mono text-xs`}>from:&lt;username&gt;</td><td className={td}>One user&apos;s posts and replies</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-slate-600">Boolean operators, quotes and combining operators aren&apos;t supported. No matches returns <span className={mono}>{'{"meta":{"result_count":0}}'}</span>.</p>
      </Section>

      <Section id="limits" title="Rate limits">
        <p className="text-sm text-slate-700">
          <strong>180 requests per 15 minutes</strong> per token (per IP without a valid token). Every <span className={mono}>/2/*</span> response has:
        </p>
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
          <li><span className={mono}>x-rate-limit-limit</span>: requests allowed per window</li>
          <li><span className={mono}>x-rate-limit-remaining</span>: requests left this window</li>
          <li><span className={mono}>x-rate-limit-reset</span>: when the window resets (unix seconds)</li>
        </ul>
        <p className="text-sm text-slate-700">Over the limit returns <span className={mono}>429</span>. Responses are never cached, so new posts show up immediately.</p>
      </Section>

      <Section id="errors" title="Errors">
        <Code>{'{ "title": "Unauthorized", "type": "about:blank", "status": 401, "detail": "Unauthorized" }'}</Code>
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
          <li><span className={mono}>400</span>: invalid params (<span className={mono}>detail</span> names the param)</li>
          <li><span className={mono}>401</span>: missing or invalid token</li>
          <li><span className={mono}>404</span>: unknown route</li>
          <li><span className={mono}>429</span>: rate limited</li>
          <li><span className={mono}>502</span> / <span className={mono}>500</span>: upstream or server failure</li>
          <li>Post lookups for unknown ids return <span className={mono}>200</span> with an <span className={mono}>errors</span> array, like X.</li>
        </ul>
      </Section>

      <Section id="try" title="Try it">
        <form onSubmit={submit} className="space-y-3">
          <label className={label}>
            Bearer token
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="paste a token (kept in memory only)"
              className={`${input} font-mono`}
            />
          </label>
          <label className={label}>
            Endpoint
            <select value={key} onChange={(e) => { setKey(e.target.value as EndpointKey); setResult(null); }} className={input}>
              {ENDPOINTS.map((e) => <option key={e.key} value={e.key}>{e.label} · {e.path}</option>)}
            </select>
          </label>

          {key === 'search' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_7rem]">
              <label className={label}>query<input value={params.query} onChange={set('query')} className={`${input} font-mono`} /></label>
              <label className={label}>max_results<input value={params.maxResults} onChange={set('maxResults')} inputMode="numeric" className={input} /></label>
              <label className={`${label} sm:col-span-2`}>next_token (optional)<input value={params.nextToken} onChange={set('nextToken')} className={`${input} font-mono`} /></label>
            </div>
          )}
          {key === 'tweet' && <label className={label}>id<input value={params.id} onChange={set('id')} className={`${input} font-mono`} /></label>}
          {key === 'tweets' && <label className={label}>ids (comma-separated)<input value={params.ids} onChange={set('ids')} className={`${input} font-mono`} /></label>}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white hover:bg-accent-dark disabled:opacity-50">
              {busy ? 'Sending…' : 'Send'}
            </button>
            {ep.auth && !token.trim() && <span className="text-xs text-slate-500">No token: expect a 401.</span>}
          </div>
          <p className="break-all font-mono text-xs text-slate-500">GET {path}</p>
        </form>

        {result && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${result.status >= 200 && result.status < 300 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                {result.status || 'ERR'}
              </span>
              <span className="text-slate-500">{result.ms} ms</span>
              {result.next && (
                <button type="button" onClick={nextPage} disabled={busy} className="rounded-full border border-slate-300 px-3 py-0.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
                  Next page →
                </button>
              )}
            </div>
            {result.headers && <pre className="overflow-x-auto rounded-xl bg-slate-100 p-3 font-mono text-xs text-slate-700">{result.headers}</pre>}
            <pre className="max-h-[60vh] overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-xs leading-relaxed text-violet-200">{result.body}</pre>
          </div>
        )}
      </Section>
    </>
  );
}
