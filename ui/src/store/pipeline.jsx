import { useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react'
import { makeSeed } from '../data/seed'
import { reducer, STORAGE_KEY, TICK_MS } from './reducer'
import { restorePipelineState } from './restore.js'
import { evaluatePatch, fetchSimulationConfig } from '../simulation/client.js'
import { PipelineContext as Ctx } from './context.js'
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
    if (saved) return restorePipelineState(JSON.parse(saved))
  } catch {
    /* fall through to seed */
  }
  return makeSeed()
}

const init = () => (supabaseEnabled ? emptyState() : localInit())

export function PipelineProvider({ children }) {
  const [state, rawDispatch] = useReducer(reducer, undefined, init)
  const [simulationState, setSimulationState] = useState({ config: null, loading: true, error: null })
  // 'loading' only matters when Supabase is the source of truth.
  const [loadState, setLoadState] = useState(supabaseEnabled ? 'loading' : 'ready')
  const saveTimer = useRef(null)
  const configRequest = useRef(null)
  const activeRuns = useRef(new Map())

  const reload = useCallback(() => {
    configRequest.current?.abort()
    const controller = new AbortController()
    configRequest.current = controller
    setSimulationState({ config: null, loading: true, error: null })
    return fetchSimulationConfig({ signal: controller.signal }).then(config => {
      if (!controller.signal.aborted) setSimulationState({ config, loading: false, error: null })
      return controller.signal.aborted ? null : config
    }).catch(error => {
      if (!controller.signal.aborted) setSimulationState({ config: null, loading: false, error: error.message })
      return null
    })
  }, [])

  const dispatch = useCallback(action => {
    const needsConfig = ['SPEC_APPROVE', 'PLAYTEST_RERUN'].includes(action.type) ||
      (action.type === 'RETRY_RUN' && state.issues.find(issue => issue.id === action.id)?.error?.run?.kind === 'simulation')
    if (needsConfig && !action.config && !simulationState.config) {
      void reload().then(config => { if (config) rawDispatch({ ...action, config }) })
    } else rawDispatch(needsConfig ? { ...action, config: action.config ?? simulationState.config } : action)
  }, [simulationState.config, state.issues, reload])

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
          rawDispatch({ type: 'HYDRATE', state: next })
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
    let disposed = false
    queueMicrotask(() => { if (!disposed) reload() })
    const jobs = activeRuns.current
    return () => {
      disposed = true
      configRequest.current?.abort()
      for (const job of jobs.values()) job.abort()
      jobs.clear()
      clearTimeout(saveTimer.current)
    }
  }, [reload])

  useEffect(() => {
    const pending = state.issues.filter(issue => issue.run?.kind === 'simulation')
    const ids = new Set(pending.map(issue => issue.run.id))
    for (const [runId, controller] of activeRuns.current) {
      if (!ids.has(runId)) { controller.abort(); activeRuns.current.delete(runId) }
    }
    for (const issue of pending) {
      const run = issue.run
      if (activeRuns.current.has(run.id)) continue
      const controller = new AbortController()
      activeRuns.current.set(run.id, controller)
      evaluatePatch(run.request, { signal: controller.signal }).then(result => {
        if (!controller.signal.aborted) rawDispatch({ type: 'SIMULATION_SUCCEEDED', id: issue.id, runId: run.id, result })
      }).catch(error => {
        if (!controller.signal.aborted) rawDispatch({ type: 'SIMULATION_FAILED', id: issue.id, runId: run.id, message: error.message })
      }).finally(() => {
        if (activeRuns.current.get(run.id) === controller) activeRuns.current.delete(run.id)
      })
    }
  }, [state.issues])

  useEffect(() => {
    const t = setInterval(() => rawDispatch({ type: 'TICK' }), TICK_MS)
    const ing = setInterval(() => rawDispatch({ type: 'INGEST_TICK' }), 2600)
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

  return <Ctx.Provider value={{ state, dispatch, loadState, supabase, simulation: { ...simulationState, reload } }}>{children}</Ctx.Provider>
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
