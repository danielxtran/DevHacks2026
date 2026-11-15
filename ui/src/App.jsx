import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { usePipeline } from './store/pipeline'
import { Button, StateView } from './components/ui'
import ErrorBoundary from './components/ErrorBoundary'
import RiotLogo from './components/RiotLogo'
import { useTheme } from './hooks/useTheme'
import Board from './pages/Board'
import List from './pages/List'
import IssueLayout from './pages/IssueLayout'
import IssueDetail from './pages/IssueDetail'
import WorkflowPage from './pages/WorkflowPage'

// Riot nav: small uppercase links. Hover and selection show a translucent rounded box (as on riotgames.com);
// the selected one also gets a red bar on the header's bottom edge.
function NavItem({ to, end, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `group relative flex h-full items-center text-xs font-bold uppercase tracking-[0.1em] ${isActive ? 'text-text after:absolute after:inset-x-1 after:bottom-0 after:h-1 after:rounded-t-sm after:bg-accent' : 'text-muted hover:text-text'}`
      }
    >
      {({ isActive }) => <span className={`sel px-2 py-2 sm:px-3 ${isActive ? 'is-selected' : ''}`}>{children}</span>}
    </NavLink>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
    >
      {theme === 'dark' ? (
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  )
}

function SourceHealth() {
  const { state } = usePipeline()
  const labels = { reddit: 'Riotdit', x: 'R' }
  return (
    <div className="mb-6 flex flex-wrap gap-4 text-xs text-muted" aria-label="Source collection status">
      {Object.entries(labels).map(([key, label]) => {
        const source = state.sourceStatus[key]
        return <p key={key} className={['error', 'incomplete'].includes(source?.state) ? 'text-warning' : ''}>
          {label}: {source?.status ?? 'not collected yet'}
          {source?.completedAt && ` · ${new Date(source.completedAt).toLocaleString()}`}
          {source?.message && ` · ${source.message}`}
        </p>
      })}
    </div>
  )
}

function TopBar() {
  const { lastUpdated, refresh } = usePipeline()
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center gap-3 px-4 sm:gap-10 sm:px-6">
        <Link to="/" aria-label="Riot Games, home" className="text-text">
          <RiotLogo className="h-6 w-auto sm:h-7" />
        </Link>
        <nav aria-label="Main" className="flex h-full items-center gap-1 sm:gap-2">
          <NavItem to="/" end>Board</NavItem>
          <NavItem to="/list">List</NavItem>
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span className="hidden text-xs text-muted sm:block" role="status">
            {lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : 'Connecting to backend…'}
          </span>
          <Button size="sm" variant="ghost" onClick={refresh}>Refresh</Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

export default function App() {
  const { pathname, search } = useLocation()
  const { loadState, lastUpdated, error, refresh } = usePipeline()
  return (
    <div className="min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-accent focus:px-3 focus:py-2">
        Skip to content
      </a>
      <TopBar />
      <main id="main" className="mx-auto max-w-6xl px-6 pb-24 pt-10">
        {lastUpdated && <SourceHealth />}
        {loadState === 'loading' ? (
          <StateView kind="loading" title="Loading discovered issues…" />
        ) : (
          <ErrorBoundary key={pathname}>
            {loadState === 'error' && (
              <div className="mb-6">
                <StateView kind="error" title={lastUpdated ? 'Tracker data may be stale' : 'Couldn’t load tracker data'} action={<Button onClick={refresh}>Retry</Button>}>
                  {error} {lastUpdated ? 'Keeping the last successful response while reconnecting.' : 'No demo data is substituted.'}
                </StateView>
              </div>
            )}
            {(loadState !== 'error' || lastUpdated) && <Routes>
            <Route path="/" element={<Board />} />
            <Route path="/list" element={<List />} />
            {/* Old address for the List tab */}
            <Route path="/feedback" element={<Navigate to="/list" replace />} />
            <Route path="/issues/:id" element={<IssueLayout />}>
              <Route index element={<IssueDetail />} />
              <Route path="spec" element={<WorkflowPage mode="spec" />} />
              <Route path="results" element={<WorkflowPage mode="results" />} />
              <Route path="playtest" element={<Navigate to={`../results${search}`} replace />} />
              <Route path="verified" element={<Navigate to={`../results${search}`} replace />} />
            </Route>
            <Route path="*" element={<StateView kind="empty" title="Page not found" action={<Button to="/">Back to board</Button>} />} />
            </Routes>}
          </ErrorBoundary>
        )}
      </main>
    </div>
  )
}
