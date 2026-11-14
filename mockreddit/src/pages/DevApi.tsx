import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { COMMUNITY, SITE_NAME } from '../config';

type EndpointKey = 'new' | 'hot' | 'top' | 'comments' | 'about' | 'health';

interface Endpoint {
  key: EndpointKey;
  path: string;
  description: string;
  paged?: boolean;
}

const ENDPOINTS: Endpoint[] = [
  { key: 'new', path: `/r/${COMMUNITY}/new.json`, description: 'Newest posts first. Each post includes its comments.', paged: true },
  { key: 'hot', path: `/r/${COMMUNITY}/hot.json`, description: 'Ranked by score and age, like the Hot tab.', paged: true },
  { key: 'top', path: `/r/${COMMUNITY}/top.json`, description: 'Highest score first.', paged: true },
  { key: 'comments', path: `/r/${COMMUNITY}/comments/{id}.json`, description: 'One post plus its comment tree: [postListing, commentsListing].' },
  { key: 'about', path: `/r/${COMMUNITY}/about.json`, description: 'Community info (t5).' },
  { key: 'health', path: '/api/health', description: 'Service and upstream status. 503 when the data store is unreachable.' },
];

const DEFAULT_POST_ID = 's001';

function buildPath(ep: Endpoint, opts: { limit: string; after: string; postId: string }) {
  if (ep.key === 'comments') return ep.path.replace('{id}', encodeURIComponent(opts.postId.trim() || DEFAULT_POST_ID));
  if (!ep.paged) return ep.path;
  const qs = new URLSearchParams();
  if (opts.limit.trim()) qs.set('limit', opts.limit.trim());
  if (opts.after.trim()) qs.set('after', opts.after.trim());
  const s = qs.toString();
  return s ? `${ep.path}?${s}` : ep.path;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (insecure context or permissions): the text is still selectable
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded border border-slate-600 px-2 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-slate-900 px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed text-emerald-200">{children}</code>
      <CopyButton text={children} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

const th = 'border-b border-slate-200 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';
const td = 'border-b border-slate-100 px-2 py-1.5 align-top';

export default function DevApi() {
  const base = window.location.origin;
  const curl = (p: string) => `curl -A "my-agent/1.0" "${base}${p}"`;

  const [key, setKey] = useState<EndpointKey>('new');
  const [limit, setLimit] = useState('5');
  const [after, setAfter] = useState('');
  const [postId, setPostId] = useState(DEFAULT_POST_ID);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: number; ms: number; headers: string; body: string; after: string | null } | null>(null);

  const ep = ENDPOINTS.find((e) => e.key === key)!;
  const path = useMemo(() => buildPath(ep, { limit, after, postId }), [ep, limit, after, postId]);

  async function run(p: string) {
    setBusy(true);
    const t0 = performance.now();
    try {
      const res = await fetch(p, { headers: { Accept: 'application/json' } });
      const text = await res.text();
      let body = text;
      let next: string | null = null;
      try {
        const json = JSON.parse(text);
        body = JSON.stringify(json, null, 2);
        next = json?.kind === 'Listing' ? json.data?.after ?? null : null;
      } catch {
        // not JSON (e.g. the API server isn't running and the dev server answered): show raw text
      }
      const headers = ['x-ratelimit-used', 'x-ratelimit-remaining', 'x-ratelimit-reset']
        .map((h) => `${h}: ${res.headers.get(h) ?? '-'}`)
        .join('\n');
      setResult({ status: res.status, ms: Math.round(performance.now() - t0), headers, body, after: next });
    } catch {
      setResult({ status: 0, ms: Math.round(performance.now() - t0), headers: '', body: "Network error: can't reach the API.", after: null });
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(path);
  }

  function nextPage() {
    if (!result?.after) return;
    setAfter(result.after);
    void run(buildPath(ep, { limit, after: result.after, postId }));
  }

  const input = 'rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-accent focus:outline-none';

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-dark">Developers</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{SITE_NAME} public API</h1>
        <p className="mt-2 text-sm text-slate-600">
          Read-only JSON endpoints shaped like Reddit&apos;s <code className="font-mono">.json</code> API. No key needed.
          Please send a descriptive <code className="font-mono">User-Agent</code>.
        </p>
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold text-slate-500">Base URL</p>
          <Code>{base}</Code>
        </div>
      </div>

      <Section title="Endpoints">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr><th className={th}>Method</th><th className={th}>Path</th><th className={th}>Returns</th></tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.key}>
                  <td className={`${td} font-mono text-xs font-semibold text-accent-dark`}>GET</td>
                  <td className={`${td} whitespace-nowrap font-mono text-xs`}>{e.path}</td>
                  <td className={`${td} text-slate-600`}>{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-slate-600">
          Only <code className="font-mono">r/{COMMUNITY}</code> exists (case-insensitive). Any other name returns 404.
        </p>
      </Section>

      <Section title="Listing parameters">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Param</th><th className={th}>Rule</th></tr></thead>
            <tbody>
              <tr><td className={`${td} font-mono text-xs`}>limit</td><td className={td}>Integer 1–100, default 25.</td></tr>
              <tr>
                <td className={`${td} font-mono text-xs`}>after</td>
                <td className={td}>
                  <code className="font-mono">t3_&lt;id&gt;</code> from the previous page&apos;s <code className="font-mono">data.after</code>.
                  Keep paging until it&apos;s <code className="font-mono">null</code>.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-slate-600">Unknown params are ignored. Invalid values return 400 and name the param.</p>
      </Section>

      <Section title="Rate limits and errors">
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
          <li><strong>60 requests per minute per IP.</strong> Every response has <code className="font-mono">X-Ratelimit-Used</code>, <code className="font-mono">X-Ratelimit-Remaining</code> and <code className="font-mono">X-Ratelimit-Reset</code> (seconds).</li>
          <li>Over the limit: <code className="font-mono">429</code> with <code className="font-mono">Retry-After</code>.</li>
          <li>Errors look like <code className="font-mono">{'{"message":"Not Found","error":404}'}</code>: 400 bad param, 404 unknown sub/post, 429, 502 upstream failure, 500.</li>
          <li>Responses are never cached (<code className="font-mono">Cache-Control: no-store</code>), so new posts appear immediately.</li>
        </ul>
      </Section>

      <Section title="Examples">
        <div className="space-y-3">
          {ENDPOINTS.map((e) => (
            <div key={e.key}>
              <p className="mb-1 text-xs font-semibold text-slate-500">{e.path}</p>
              <Code>{curl(buildPath(e, { limit: '5', after: '', postId: DEFAULT_POST_ID }))}</Code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Try it">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">
            Endpoint
            <select value={key} onChange={(e) => { setKey(e.target.value as EndpointKey); setResult(null); }} className={input}>
              {ENDPOINTS.map((e) => <option key={e.key} value={e.key}>{e.key === 'health' ? 'api/health' : `${e.key}.json`}</option>)}
            </select>
          </label>
          {ep.paged && (
            <>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500">
                limit
                <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" className={`${input} w-20`} />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-slate-500">
                after (optional)
                <input value={after} onChange={(e) => setAfter(e.target.value)} placeholder="t3_…" className={`${input} font-mono`} />
              </label>
            </>
          )}
          {ep.key === 'comments' && (
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-slate-500">
              Post id
              <input value={postId} onChange={(e) => setPostId(e.target.value)} className={`${input} font-mono`} />
            </label>
          )}
          <button type="submit" disabled={busy} className="rounded-full bg-accent px-5 py-1.5 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-50">
            {busy ? 'Fetching…' : 'Fetch'}
          </button>
        </form>
        <p className="break-all font-mono text-xs text-slate-500">GET {path}</p>

        {result && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${result.status >= 200 && result.status < 300 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                {result.status || 'ERR'}
              </span>
              <span className="text-slate-500">{result.ms} ms</span>
              {result.after && (
                <button type="button" onClick={nextPage} disabled={busy} className="rounded-full border border-slate-300 px-3 py-0.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
                  Next page →
                </button>
              )}
            </div>
            {result.headers && <pre className="overflow-x-auto rounded-md bg-slate-100 p-2 font-mono text-xs text-slate-700">{result.headers}</pre>}
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-slate-900 p-3 font-mono text-xs leading-relaxed text-emerald-200">{result.body}</pre>
          </div>
        )}
      </Section>
    </div>
  );
}
