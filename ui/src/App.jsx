import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { usePipeline } from './store/pipeline'
import { Button, Menu, MenuItem, StateView } from './components/ui'
import ErrorBoundary from './components/ErrorBoundary'
import RiotLogo from './components/RiotLogo'
import { useTheme } from './hooks/useTheme'
import Overview from './pages/Overview'
import Feedback from './pages/Feedback'
import IssueLayout from './pages/IssueLayout'
import IssueDetail from './pages/IssueDetail'
import SpecWorkspace from './pages/SpecWorkspace'
import PlaytestResults from './pages/PlaytestResults'

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
      {({ isActive }) => <span className={`sel px-3 py-2 ${isActive ? 'is-selected' : ''}`}>{children}</span>}
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

function DemoMenu() {
  const { state, dispatch } = usePipeline()
  return (
    <Menu label="Demo controls" trigger={<span className="text-xs font-bold uppercase tracking-[0.1em]">Demo</span>}>
      <MenuItem onClick={() => dispatch({ type: 'DEMO_FAIL_NEXT', value: !state.demo.failNext })}>
        {state.demo.failNext ? '✓ ' : ''}Fail the next agent run
      </MenuItem>
      <MenuItem onClick={() => dispatch({ type: 'DEMO_BREAK_SOURCE', source: 'reddit' })}>Break the Reddit scraper</MenuItem>
      <MenuItem onClick={() => dispatch({ type: 'DEMO_CLEAR' })}>Clear issues (empty state)</MenuItem>
      <MenuItem onClick={() => dispatch({ type: 'RESET' })}>Reset demo data</MenuItem>
    </Menu>
  )
}

function TopBar() {
  const { state } = usePipeline()
  const running = state.issues.filter((i) => i.run).length
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center gap-10 px-6">
        <Link to="/" aria-label="Riot Games, home" className="text-text">
          <RiotLogo className="h-7 w-auto" />
        </Link>
        <nav aria-label="Main" className="flex h-full items-center gap-2">
          <NavItem to="/" end>Board</NavItem>
          <NavItem to="/feedback">List</NavItem>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {running > 0 && (
            <span className="flex items-center gap-2 text-xs text-muted" role="status">
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-info" />
              {running} agent{running === 1 ? '' : 's'} working
            </span>
          )}
          <ThemeToggle />
          <DemoMenu />
        </div>
      </div>
    </header>
  )
}

export default function App() {
  const { pathname } = useLocation()
  return (
    <div className="min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-accent focus:px-3 focus:py-2">
        Skip to content
      </a>
      <TopBar />
      <main id="main" className="mx-auto max-w-6xl px-6 pb-24 pt-10">
        <ErrorBoundary key={pathname}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="/issues/:id" element={<IssueLayout />}>
              <Route index element={<IssueDetail />} />
              <Route path="spec" element={<SpecWorkspace />} />
              <Route path="playtest" element={<PlaytestResults />} />
              <Route path="verified" element={<PlaytestResults view="verified" />} />
            </Route>
            <Route path="*" element={<StateView kind="empty" title="Page not found" action={<Button to="/">Back to board</Button>} />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  )
}
