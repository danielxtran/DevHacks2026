import { useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react'
import { makeSeed } from '../data/seed'
import { reducer, STORAGE_KEY, TICK_MS } from './reducer'
import { restorePipelineState } from './restore.js'
import { evaluatePatch, fetchSimulationConfig } from '../simulation/client.js'
import { PipelineContext as Ctx } from './context.js'

// ---------- provider ----------
function init() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return restorePipelineState(JSON.parse(saved))
  } catch {
    /* fall through to seed */
  }
  return makeSeed()
}

export function PipelineProvider({ children }) {
  const [state, rawDispatch] = useReducer(reducer, undefined, init)
  const [simulationState, setSimulationState] = useState({ config: null, loading: true, error: null })
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

  useEffect(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {
        /* storage full or disabled: run in-memory */
      }
    }, 300)
  }, [state])

  return <Ctx.Provider value={{ state, dispatch, simulation: { ...simulationState, reload } }}>{children}</Ctx.Provider>
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
