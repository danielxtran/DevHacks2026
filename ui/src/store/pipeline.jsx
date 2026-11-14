import { createContext, useContext, useEffect, useReducer, useRef } from 'react'
import { makeSeed } from '../data/seed'
import { reducer, STORAGE_KEY, TICK_MS } from './reducer'

// ---------- provider ----------
function init() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {
    /* fall through to seed */
  }
  return makeSeed()
}

const Ctx = createContext(null)

export function PipelineProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, init)
  const saveTimer = useRef(null)

  useEffect(() => {
    const t = setInterval(() => dispatch({ type: 'TICK' }), TICK_MS)
    const ing = setInterval(() => dispatch({ type: 'INGEST_TICK' }), 2600)
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

  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePipeline() {
  return useContext(Ctx)
}

export function useIssue(id) {
  const { state } = usePipeline()
  return state.issues.find((i) => i.id === id)
}
