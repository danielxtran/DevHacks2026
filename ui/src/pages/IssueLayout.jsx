import { useState } from 'react'
import { Link, Outlet, useLocation, useParams } from 'react-router-dom'
import { useIssue, usePipeline } from '../store/pipeline'
import { StageStepper } from '../components/pipelineParts'
import { Button, StateView } from '../components/ui'
import { num } from '../components/format'

function EditableTitle({ issue }) {
  const { dispatch } = usePipeline()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(issue.title)
  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim() && value !== issue.title) dispatch({ type: 'EDIT_TITLE', id: issue.id, title: value.trim() })
          setEditing(false)
        }}
      >
        <input autoFocus aria-label="Issue title" value={value} onChange={(e) => setValue(e.target.value)} className="min-w-[20rem] flex-1 rounded-lg border border-border bg-transparent px-3 py-1.5 font-display text-3xl font-bold tracking-tight" />
        <Button variant="primary" type="submit">Save</Button>
        <Button variant="ghost" type="button" onClick={() => { setValue(issue.title); setEditing(false) }}>Cancel</Button>
      </form>
    )
  }
  return (
    <h1 className="group font-display text-3xl font-bold tracking-tight md:text-4xl">
      {issue.title}
      <button type="button" onClick={() => setEditing(true)} className="ml-3 align-middle text-sm font-normal text-muted opacity-0 hover:text-text focus:opacity-100 group-hover:opacity-100">
        Edit
      </button>
    </h1>
  )
}

export default function IssueLayout() {
  const { id } = useParams()
  const { pathname } = useLocation()
  const issue = useIssue(id)
  const { state } = usePipeline()

  if (!issue) {
    return <StateView kind="empty" title="Issue not found" action={<Button to="/">Back to board</Button>}>It may have been merged, or the demo data was reset.</StateView>
  }
  const current = { spec: 'spec', playtest: 'playtest', verified: 'verified' }[pathname.split('/').pop()] ?? 'feedback'
  const merged = issue.mergedInto && state.issues.find((i) => i.id === issue.mergedInto)
  const rank = [...state.issues].filter((i) => !i.mergedInto && !i.dismissed).sort((a, b) => b.mentions - a.mentions).findIndex((i) => i.id === issue.id) + 1

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        <Link to="/" className="hover:text-text">← Board</Link>
        <span className="mx-2">·</span>
        {issue.game}
        {rank > 0 && <> · #{rank}</>} · {num(issue.mentions)} mentions
      </p>
      <EditableTitle key={issue.title} issue={issue} />
      {merged && (
        <p className="mt-2 text-sm text-muted">
          Merged into <Link className="text-text underline" to={`/issues/${merged.id}`}>{merged.title}</Link>
        </p>
      )}
      <div className="mt-6 border-b border-border pb-1">
        <StageStepper issue={issue} current={current} />
      </div>
      <div className="pt-10">
        <Outlet context={{ issue }} />
      </div>
    </div>
  )
}
