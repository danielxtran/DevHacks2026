import { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react'
import { makeSeed } from '../data/seed'
import { reducer, STORAGE_KEY, TICK_MS } from './reducer'
import { supabase, supabaseEnabled, loadStateFromSupabase } from '../data/supabase'

// ---------- provider ----------
// An empty-but-valid state shape. When Supabase is the source of truth, the
// reducer starts empty and is filled by HYDRATE after the initial load — we
// never seed mock issues or read stale issues from localStorage.
function emptyState() {
  return { issues: [], sourceStatus: {}, ingest: { postsToday: 0, newSinceOpen: 0 }, demo: { failNext: false } }
}

// Local init used ONLY when Supabase is not configured: last-session
// localStorage, else the generated seed (offline/demo mode).
function localInit() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {
    /* fall through to seed */
  }
  return makeSeed()
}

const init = () => (supabaseEnabled ? emptyState() : localInit())

const Ctx = createContext(null)

export function PipelineProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, init)
  // 'loading' only matters when Supabase is the source of truth.
  const [loadState, setLoadState] = useState(supabaseEnabled ? 'loading' : 'ready')
  const saveTimer = useRef(null)

  // Supabase is the sole source of issues. Load issues + ui_* companion tables
  // on mount. On failure we show an error and stay empty — no mock fallback.
  // The client-side agent simulation (TICK) still runs on top of this for the
  // "minimal" integration; writing actions back to Supabase is a later step.
  useEffect(() => {
    if (!supabaseEnabled) return
    let cancelled = false
    ;(async () => {
      try {
        const next = await loadStateFromSupabase()
        if (!cancelled) {
          dispatch({ type: 'HYDRATE', state: next })
          setLoadState('ready')
        }
      } catch (e) {
        console.error('Supabase load failed:', e)
        if (!cancelled) setLoadState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const t = setInterval(() => dispatch({ type: 'TICK' }), TICK_MS)
    const ing = setInterval(() => dispatch({ type: 'INGEST_TICK' }), 2600)
    return () => {
      clearInterval(t)
      clearInterval(ing)
    }
  }, [])

  // Persist to localStorage only as a within-session convenience when Supabase
  // is NOT the source of truth. With Supabase on, every reload re-pulls from the
  // backend, so we don't want a stale local snapshot masking it.
  useEffect(() => {
    if (supabaseEnabled) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {
        /* storage full or disabled: run in-memory */
      }
    }, 300)
  }, [state])

  return <Ctx.Provider value={{ state, dispatch, loadState, supabase }}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePipeline() {
  return useContext(Ctx)
}

// eslint-disable-next-line react-refresh/only-export-components
export function useIssue(id) {
  const { state } = usePipeline()
  return state.issues.find((i) => i.id === id)
}
