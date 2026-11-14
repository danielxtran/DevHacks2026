import { createContext, useCallback, useContext, useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { APP_NAME, TAGLINE, postPath, searchPath } from '../config';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { topHashtags } from '../lib/text';
import { Composer } from './Composer';
import { ErrorBanner } from './ui';
import { HomeIcon, PenIcon, SearchIcon } from './Icons';
import { Logo } from './Logo';

/** Lets any page open the "Post" composer modal. */
const ComposeContext = createContext<() => void>(() => {});
export const useOpenComposer = () => useContext(ComposeContext);

const navItem = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-4 rounded-full p-3 text-xl transition-colors hover:bg-slate-100 xl:pr-6 ${isActive ? 'font-bold' : ''}`;

export function Layout() {
  const [composing, setComposing] = useState(false);
  const open = useCallback(() => setComposing(true), []);

  return (
    <ComposeContext.Provider value={open}>
      <div className="mx-auto flex min-h-screen max-w-[1265px] justify-center">
        {/* Left nav: full under xl, icons only from sm, bottom bar on mobile */}
        <header className="sticky top-0 hidden h-screen w-[88px] shrink-0 flex-col items-center gap-1 px-2 py-2 sm:flex xl:w-[275px] xl:items-stretch">
          <Link to="/" aria-label={`${APP_NAME} home`} className="mb-2 rounded-full p-2 hover:bg-accent-light xl:self-start">
            <Logo />
          </Link>
          <NavLink to="/" end className={navItem}>
            {({ isActive }) => <><HomeIcon filled={isActive} /><span className="hidden xl:inline">Home</span></>}
          </NavLink>
          <NavLink to="/search" className={navItem}>
            <SearchIcon /><span className="hidden xl:inline">Search</span>
          </NavLink>
          <button
            type="button"
            onClick={open}
            aria-label="Post"
            className="mt-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-lg font-bold text-white shadow hover:bg-accent-dark xl:w-full"
          >
            <PenIcon className="h-6 w-6 xl:hidden" />
            <span className="hidden xl:inline">Post</span>
          </button>
        </header>

        <main className="min-h-screen w-full min-w-0 max-w-[600px] border-slate-100 pb-16 sm:border-x sm:pb-0">
          {!supabaseConfigured && (
            <ErrorBanner message="Supabase isn't configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the repository-root .env, then restart the dev server." />
          )}
          <Outlet />
        </main>

        <Sidebar />
      </div>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-slate-200 bg-white py-1 sm:hidden" aria-label="Main">
        <NavLink to="/" end className="rounded-full p-3" aria-label="Home">{({ isActive }) => <HomeIcon filled={isActive} />}</NavLink>
        <NavLink to="/search" className="rounded-full p-3" aria-label="Search"><SearchIcon /></NavLink>
        <button type="button" onClick={open} aria-label="Post" className="rounded-full p-3 text-accent"><PenIcon /></button>
      </nav>

      {composing && <ComposeModal onClose={() => setComposing(false)} />}
    </ComposeContext.Provider>
  );
}

function ComposeModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-slate-900/40 p-4 sm:pt-16" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New post"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[600px] rounded-2xl bg-white p-4 shadow-xl"
      >
        <button type="button" onClick={onClose} aria-label="Close" className="mb-1 rounded-full px-2 py-1 text-slate-600 hover:bg-slate-100">✕</button>
        <Composer autoFocus onPosted={(p) => { onClose(); navigate(postPath(p.id)); }} />
      </div>
    </div>
  );
}

function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [q, setQ] = useState('');
  const [trending, setTrending] = useState<{ tag: string; count: number }[] | null>(null);

  // Top 5 hashtags across the latest 100 posts, refreshed on navigation.
  useEffect(() => {
    if (!supabaseConfigured) return;
    let cancelled = false;
    supabase.from('posts').select('body').order('created_at', { ascending: false }).limit(100).then(({ data }) => {
      if (!cancelled && data) setTrending(topHashtags(data.map((r) => r.body as string)));
    });
    return () => { cancelled = true; };
  }, [pathname]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (q.trim()) navigate(searchPath(q.trim()));
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-[350px] shrink-0 space-y-4 overflow-y-auto px-6 py-2 lg:block">
      {pathname !== '/search' && (
        <form onSubmit={submit} role="search">
          <label className="flex items-center gap-3 rounded-full bg-slate-100 px-4 py-2.5 text-slate-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-accent">
            <SearchIcon className="h-5 w-5" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-full bg-transparent text-slate-900 focus:outline-none" />
          </label>
        </form>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50">
        <h2 className="px-4 pb-1 pt-3 text-xl font-extrabold">Trending</h2>
        {trending === null ? (
          <div className="space-y-3 px-4 py-3">{[0, 1, 2].map((i) => <div key={i} className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />)}</div>
        ) : trending.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">No hashtags yet.</p>
        ) : (
          <ol>
            {trending.map((t, i) => (
              <li key={t.tag}>
                <Link to={searchPath(`#${t.tag}`)} className="block px-4 py-2.5 hover:bg-slate-100">
                  <p className="text-xs text-slate-500">{i + 1} · Trending in Patchwork TFT</p>
                  <p className="font-bold">#{t.tag}</p>
                  <p className="text-xs text-slate-500">{t.count} {t.count === 1 ? 'post' : 'posts'}</p>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="px-4 text-xs text-slate-400">{APP_NAME} · {TAGLINE}</p>
    </aside>
  );
}
