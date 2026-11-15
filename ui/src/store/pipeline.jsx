import { useContext, useEffect, useState } from 'react'
import { useLocation, useMatch } from 'react-router-dom'
import { sendCommand, watchPipeline } from '../data/live.js'

import { PipelineContext as Ctx } from './context.js'

export function PipelineProvider({ children }) {
  const issueId = useMatch('/issues/:id/*')?.params.id
  const runId = new URLSearchParams(useLocation().search).get('run')
  const [state, setState] = useState({ issues: [], sourceStatus: {}, capabilities: {}, workflow: null })
  const [loadState, setLoadState] = useState('loading')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [error, setError] = useState(null)
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision(value => value + 1)

  useEffect(() => watchPipeline(issueId, next => {
    setState(next)
    setLoadState('ready')
    setLastUpdated(new Date().toISOString())
    setError(null)
  }, failure => {
    setLoadState('error')
    setError(failure.message)
  }, runId), [issueId, runId, revision])

  const command = async (path, method, body) => {
    const result = await sendCommand(path, method, body)
    refresh()
    return result
  }

  return <Ctx.Provider value={{ state, loadState, lastUpdated, error, refresh, command }}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePipeline() {
  return useContext(Ctx)
}

// eslint-disable-next-line react-refresh/only-export-components
export function useIssue(id) {
  const { state } = usePipeline()
  return state.issues.find(issue => issue.id === id)
}
