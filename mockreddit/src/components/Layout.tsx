import { useCallback, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { COMMUNITY, COMMUNITY_TAGLINE, FEED_PATH, SITE_NAME } from '../config';
import { supabaseConfigured } from '../lib/supabase';
import { CreatePostModal } from './CreatePostModal';
import { ErrorBanner } from './ErrorBanner';
import { Logo } from './Logo';

const RULES = [
  'Be civil. Critique the units, not the players.',
  'Balance posts need specifics: which unit, which comp, what happened.',
  'No spam, self-promo, or reposted clips.',
];

export function Layout() {
  const [creating, setCreating] = useState(false);
  const close = useCallback(() => setCreating(false), []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to={FEED_PATH} className="flex items-center gap-2">
            <Logo />
            <span className="text-xl font-extrabold tracking-tight text-slate-900">{SITE_NAME}</span>
          </Link>
          <Link
            to={FEED_PATH}
            className="hidden truncate rounded-full bg-accent-light px-3 py-1 text-sm font-semibold text-accent-dark sm:block"
          >
            r/{COMMUNITY}
          </Link>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-dark"
          >
            <span className="sm:hidden">+ Post</span>
            <span className="hidden sm:inline">Create post</span>
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl justify-center gap-6 px-4 py-6">
        <main className="w-full min-w-0 max-w-[720px] space-y-3">
          {!supabaseConfigured && (
            <ErrorBanner message="Supabase isn't configured. Copy .env.example to .env.local, fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server." />
          )}
          <Outlet />
        </main>

        <aside className="hidden w-80 shrink-0 space-y-4 lg:block">
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="h-10 bg-accent" />
            <div className="space-y-2 p-4">
              <h2 className="font-bold">About r/{COMMUNITY}</h2>
              <p className="text-sm text-slate-600">{COMMUNITY_TAGLINE}</p>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full rounded-full bg-accent py-1.5 text-sm font-semibold text-white hover:bg-accent-dark"
              >
                Create post
              </button>
            </div>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 font-bold">Community rules</h2>
            <ol className="list-inside list-decimal space-y-1.5 text-sm text-slate-700">
              {RULES.map((r) => <li key={r}>{r}</li>)}
            </ol>
          </section>
        </aside>
      </div>

      {creating && <CreatePostModal onClose={close} />}
    </div>
  );
}
