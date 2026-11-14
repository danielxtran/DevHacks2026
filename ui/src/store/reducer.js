import { makeSeed } from '../data/seed'
import {
  makeSpec,
  reviseSpec,
  makeBuild,
  makePlaytest,
  specScript,
  reviseScript,
  buildScript,
  playtestScript,
} from '../data/generators'
import { AGENTS, ME, devLabel, tagInfo } from '../data/constants'

export const STORAGE_KEY = 'agentic-pipeline:v11'
export const TICK_MS = 650
// The Builder retries on its own when checks fail; after this many attempts a person has to step in.
export const MAX_BUILD_ATTEMPTS = 3

const now = () => new Date().toISOString()

// ---------- helpers ----------
function log(issue, kind, actor, text) {
  return { ...issue, audit: [...issue.audit, { ts: now(), kind, actor, text }] }
}

function startRun(issue, run, demo) {
  return {
    ...issue,
    status: 'running',
    error: null,
    run: { ...run, startedAt: now(), idx: 0, willFail: demo.failNext },
  }
}

export function latestSpec(issue) {
  return issue.specVersions.at(-1)?.spec ?? null
}

export function approvedSpec(issue) {
  const v = issue.approvals.spec?.v
  return v ? issue.specVersions[v - 1].spec : latestSpec(issue)
}

const FAILURES = {
  spec_initial: { title: 'Agent error', message: 'The Spec Writer stopped before finishing: the model call timed out while reading posts. No spec was written. Retrying starts the run again from the top.' },
  spec_revise: { title: 'Agent error', message: 'The Spec Writer could not finish the rewrite (model call timed out). The current version is unchanged. Retry to send your instruction again.' },
  build: { title: 'Build failed', message: 'The build did not compile: the Builder’s edit left a trailing comma in a JSON file, so the game data failed to load. Nothing was merged and no playtest ran. Retry to let the Builder try again.' },
  playtest: { title: 'Playtest could not run', message: 'The bot pool did not start (no free simulation workers). No matches were played. Retry to queue the playtest again.' },
}

const NO_FAIL = { failNext: false }

// Applies the finished agent run's output to the issue.
function completeRun(issue) {
  const run = issue.run
  const agentName = AGENTS[run.agent].short
  if (run.willFail) {
    const f = FAILURES[run.kind]
    return log({ ...issue, status: 'error', error: { ...f, run: { ...run, willFail: false } }, run: null }, 'agent', agentName, `${f.title}: run stopped`)
  }

  switch (run.kind) {
    case 'spec_initial': {
      const spec = makeSpec(issue)
      const v = issue.specVersions.length + 1
      const next = {
        ...issue,
        run: null,
        status: 'needs_review',
        specVersions: [...issue.specVersions, { v, author: 'agent', authorName: agentName, spec, note: 'Initial draft', ts: now() }],
        chat: [
          ...issue.chat,
          { role: 'agent', text: `Spec v${v} is ready. Ask me to change it (for example “make this a smaller nerf” or “split into two phases”), or edit any section directly.`, ts: now() },
        ],
      }
      return log(next, 'agent', agentName, `Wrote spec v${v}`)
    }
    case 'spec_revise': {
      const { spec, reply } = reviseSpec(issue, latestSpec(issue), run.message)
      const v = issue.specVersions.length + 1
      const next = {
        ...issue,
        run: null,
        status: 'needs_review',
        specVersions: [...issue.specVersions, { v, author: 'agent', authorName: agentName, spec, note: `Rewrite: “${run.message.slice(0, 60)}”`, ts: now() }],
        chat: [...issue.chat, { role: 'agent', text: `${reply} That’s v${v}. Diff it against v${v - 1} in Version history.`, ts: now() }],
      }
      return log(next, 'agent', agentName, `Rewrote spec → v${v}`)
    }
    case 'build': {
      // Runs in the background. Checks decide what happens next, not the agent's "done".
      const spec = approvedSpec(issue)
      const build = { ...makeBuild(issue, spec, run.attempt), specV: issue.approvals.spec?.v ?? issue.specVersions.length }
      const failed = build.checks.filter((c) => c.status !== 'pass')
      const withBuild = { ...issue, run: null, build, builds: [...issue.builds, build] }
      if (!failed.length) {
        const logged = log(withBuild, 'agent', agentName, `Attempt ${run.attempt}: all ${build.checks.length} checks passed. Starting playtest.`)
        return startRun(logged, { agent: 'playtest', kind: 'playtest', matches: 2000, runNo: 1, script: playtestScript(2000) }, NO_FAIL)
      }
      const names = failed.map((c) => c.name).join(', ')
      const logged = log(withBuild, 'agent', agentName, `Attempt ${run.attempt}: agent said done, but ${names} failed`)
      if (run.attempt < MAX_BUILD_ATTEMPTS) {
        const attempt = run.attempt + 1
        return startRun(logged, { agent: 'build', kind: 'build', attempt, feedback: `Failed: ${names}`, script: buildScript(issue, spec, attempt) }, NO_FAIL)
      }
      return {
        ...logged,
        status: 'error',
        error: {
          title: 'Build checks keep failing',
          message: `The Builder tried ${run.attempt} times and ${names} still failed, so no playtest ran. Retry for another attempt, or reject the change to go back to the spec.`,
          run: { agent: 'build', kind: 'build', attempt: run.attempt + 1, script: buildScript(issue, spec, run.attempt + 1) },
        },
      }
    }
    case 'playtest': {
      const pt = makePlaytest(issue, approvedSpec(issue), run.matches, run.runNo)
      const specV = issue.approvals.spec?.v ?? issue.specVersions.length
      const entry = { ...pt, specV, ts: now(), outcome: null, build: issue.build, builds: issue.builds.filter((b) => b.specV === specV) }
      const next = { ...issue, run: null, status: 'needs_review', playtest: pt, playtests: [...(issue.playtests ?? []), entry] }
      return log(next, 'agent', agentName, `Ran ${run.matches.toLocaleString()} matches · verdict: ${pt.overall.replace('_', ' ')}`)
    }
    default:
      return { ...issue, run: null }
  }
}

// Drop spec versions after `fromV` (rolling back to an older version before changing it).
function rollBack(issue, fromV) {
  if (!fromV || fromV >= issue.specVersions.length) return issue
  return { ...issue, specVersions: issue.specVersions.slice(0, fromV) }
}
const rolledBackNote = (issue, fromV) =>
  fromV && fromV < issue.specVersions.length ? `Rolled back to v${fromV} (discarded v${fromV + 1}–v${issue.specVersions.length}). ` : ''

// Stamp the outcome on the newest playtest entry.
function markLast(list = [], outcome) {
  return list.map((p, k) => (k === list.length - 1 ? { ...p, outcome } : p))
}

function updateIssue(state, id, fn) {
  return { ...state, issues: state.issues.map((i) => (i.id === id ? fn(i) : i)) }
}

// ---------- reducer ----------
export function reducer(state, action) {
  const { type, id } = action
  const demo = state.demo
  const consumeFail = (s) => (s.demo.failNext ? { ...s, demo: { ...s.demo, failNext: false } } : s)

  switch (type) {
    case 'TICK': {
      let changed = false
      const issues = state.issues.map((issue) => {
        if (!issue.run) return issue
        changed = true
        const idx = issue.run.idx + 1
        if (idx > issue.run.script.length) return completeRun(issue)
        return { ...issue, run: { ...issue.run, idx } }
      })
      const t = Date.now()
      let sourceStatus = state.sourceStatus
      for (const [k, s] of Object.entries(sourceStatus)) {
        if (s.state === 'retrying' && t >= s.retryAt) {
          sourceStatus = { ...sourceStatus, [k]: { ...s, state: 'ok', message: null } }
          changed = true
        }
      }
      return changed ? { ...state, issues, sourceStatus } : state
    }

    case 'INGEST_TICK': {
      // Refill after "clear" to demo the empty → populated transition.
      if (state.refill?.length) {
        const [first, ...rest] = state.refill
        return { ...state, issues: [...state.issues, first], refill: rest }
      }
      if (!state.issues.length) return state
      const n = 1 + Math.floor(Math.random() * 4)
      const feedback = state.issues.filter((i) => !i.dismissed && !i.mergedInto && i.stage !== 'verified')
      const target = feedback[Math.floor(Math.random() * feedback.length)]
      const okSources = Object.keys(state.sourceStatus).filter((k) => state.sourceStatus[k].state === 'ok')
      const src = okSources[Math.floor(Math.random() * okSources.length)]
      const s = { ...state, ingest: { postsToday: state.ingest.postsToday + n, newSinceOpen: state.ingest.newSinceOpen + n } }
      if (!target || !src) return s
      return updateIssue(s, target.id, (i) => ({
        ...i,
        mentions: i.mentions + n,
        lastMention: now(),
        sources: { ...i.sources, [src]: (i.sources[src] || 0) + n },
        trend: [...i.trend.slice(0, -1), i.trend.at(-1) + n],
      }))
    }

    case 'SEND_TO_SPEC':
      // Gate: at least one developer must be assigned before an issue moves to development.
      if (!(state.issues.find((i) => i.id === id)?.devs ?? []).length) return state
      return consumeFail(
        updateIssue(state, id, (i) =>
          log(startRun({ ...i, stage: 'spec' }, { agent: 'spec', kind: 'spec_initial', script: specScript(i) }, demo), 'human', ME, 'Sent to Spec Writer'),
        ),
      )

    case 'SPEC_CHAT':
      // Prompting from an older version k discards versions after k; the rewrite becomes k+1 (spec 6.2.2).
      return consumeFail(
        updateIssue(state, id, (i) =>
          log(
            startRun(
              { ...rollBack(i, action.fromV), chat: [...i.chat, { role: 'human', text: action.text, ts: now() }] },
              { agent: 'spec', kind: 'spec_revise', message: action.text, script: reviseScript(action.text) },
              demo,
            ),
            'human',
            ME,
            `${rolledBackNote(i, action.fromV)}Asked Spec Writer: “${action.text.slice(0, 80)}”`,
          ),
        ),
      )

    case 'SPEC_EDIT':
      return updateIssue(state, id, (i0) => {
        const i = rollBack(i0, action.fromV)
        const v = i.specVersions.length + 1
        const base = i.specVersions.at(-1)
        return log(
          {
            ...i,
            status: 'needs_review',
            specVersions: [
              ...i.specVersions,
              { v, author: 'human', authorName: ME, spec: action.spec ?? base.spec, markdown: action.markdown, note: action.note || 'Direct edit', ts: now() },
            ],
          },
          'human',
          ME,
          `${rolledBackNote(i0, action.fromV)}Edited spec directly → v${v}`,
        )
      })

    case 'SPEC_APPROVE':
      return consumeFail(
        updateIssue(state, id, (i) => {
          const v = i.specVersions.length
          const approved = { ...i, stage: 'playtest', build: null, playtest: null, approvals: { ...i.approvals, spec: { by: ME, ts: now(), v, comment: action.comment } } }
          const logged = log(approved, 'human', ME, `Approved spec v${v}. Builder started; playtest follows when checks pass${action.comment ? `: “${action.comment}”` : ''}`)
          return startRun(logged, { agent: 'build', kind: 'build', attempt: 1, script: buildScript(logged, approvedSpec(logged), 1) }, demo)
        }),
      )

    case 'SPEC_REJECT':
      return updateIssue(state, id, (i) => log({ ...i, stage: 'feedback', status: 'rejected', run: null }, 'human', ME, `Rejected spec: “${action.comment}”`))

    case 'PLAYTEST_RERUN':
      return consumeFail(
        updateIssue(state, id, (i) => {
          const runNo = (i.playtest?.runNo ?? 0) + 1
          const next = log(i, 'human', ME, `Re-ran playtest with ${action.matches.toLocaleString()} matches`)
          return startRun(next, { agent: 'playtest', kind: 'playtest', matches: action.matches, runNo, script: playtestScript(action.matches) }, demo)
        }),
      )

    case 'PLAYTEST_VERIFY':
      return updateIssue(state, id, (i) =>
        log({ ...i, stage: 'verified', status: 'done', playtests: markLast(i.playtests, 'verified'), approvals: { ...i.approvals, playtest: { by: ME, ts: now(), comment: action.comment } } }, 'human', ME, `Marked verified${action.comment ? `: “${action.comment}”` : ''}`),
      )

    case 'PLAYTEST_REJECT':
      return updateIssue(state, id, (i) =>
        log({ ...i, stage: 'spec', status: 'needs_review', run: null, error: null, build: null, playtest: null, approvals: {}, playtests: i.playtest ? markLast(i.playtests, 'rejected') : i.playtests ?? [] }, 'human', ME, `Rejected change after playtest: “${action.comment}”. Change reverted; back to spec.`),
      )

    case 'RETRY_RUN':
      return consumeFail(
        updateIssue(state, id, (i) => (i.error?.run ? log(startRun(i, i.error.run, demo), 'human', ME, `Retried ${AGENTS[i.error.run.agent].short}`) : i)),
      )


    case 'SUBJECT_ADD':
      return updateIssue(state, id, (i) => ((i.tags ?? []).includes(action.tag) ? i : log({ ...i, tags: [...(i.tags ?? []), action.tag] }, 'human', ME, `Tagged “${tagInfo(action.tag)?.label ?? action.tag}”`)))
    case 'SUBJECT_REMOVE':
      return updateIssue(state, id, (i) => log({ ...i, tags: (i.tags ?? []).filter((t) => t !== action.tag) }, 'human', ME, `Removed tag “${tagInfo(action.tag)?.label ?? action.tag}”`))

    case 'DEV_ASSIGN':
      return updateIssue(state, id, (i) => ((i.devs ?? []).includes(action.dev) ? i : log({ ...i, devs: [...(i.devs ?? []), action.dev] }, 'human', ME, `Assigned ${devLabel(action.dev)}`)))
    case 'DEV_UNASSIGN':
      return updateIssue(state, id, (i) => log({ ...i, devs: (i.devs ?? []).filter((d) => d !== action.dev) }, 'human', ME, `Unassigned ${devLabel(action.dev)}`))

    case 'DISMISS':
      return updateIssue(state, id, (i) => log({ ...i, dismissed: true, rejection: { by: ME, ts: now(), comment: action.comment || '' } }, 'human', ME, `Rejected issue${action.comment ? `: “${action.comment}”` : ''}`))
    case 'RESTORE':
      return updateIssue(state, id, (i) => log({ ...i, dismissed: false, rejection: null }, 'human', ME, 'Restored after rejection'))

    case 'MERGE': {
      const from = state.issues.find((i) => i.id === id)
      if (!from || from.id === action.intoId) return state
      let s = updateIssue(state, id, (i) => log({ ...i, mergedInto: action.intoId }, 'human', ME, `Merged into ${action.intoId}`))
      s = updateIssue(s, action.intoId, (i) => {
        const sources = { ...i.sources }
        for (const [k, v] of Object.entries(from.sources)) sources[k] = (sources[k] || 0) + v
        return log(
          {
            ...i,
            mentions: i.mentions + from.mentions,
            sources,
            evidence: [...i.evidence, ...from.evidence.map((e) => ({ ...e, id: `${from.id}-${e.id}` }))],
            trend: i.trend.map((v, k) => v + (from.trend[k] || 0)),
            devs: [...new Set([...(i.devs ?? []), ...(from.devs ?? [])])],
            tags: [...new Set([...(i.tags ?? []), ...(from.tags ?? [])])],
            mergedFrom: [...i.mergedFrom, from.id],
          },
          'human',
          ME,
          `Merged ${from.id} (${from.mentions} mentions) into this issue`,
        )
      })
      return s
    }

    case 'COMMENT':
      return updateIssue(state, id, (i) => ({ ...i, comments: [...i.comments, { id: `c${Date.now()}`, author: ME, text: action.text, ts: now() }] }))

    case 'EDIT_TITLE':
      return updateIssue(state, id, (i) => log({ ...i, title: action.title }, 'human', ME, `Renamed issue to “${action.title}”`))

    case 'SOURCE_RETRY':
      return { ...state, sourceStatus: { ...state.sourceStatus, [action.source]: { ...state.sourceStatus[action.source], state: 'retrying', retryAt: Date.now() + 2500 } } }

    case 'DEMO_BREAK_SOURCE':
      return {
        ...state,
        sourceStatus: {
          ...state.sourceStatus,
          [action.source]: { ...state.sourceStatus[action.source], state: 'error', message: 'Scraper unavailable: the platform returned HTTP 429 (rate limited). New posts from this source are paused.' },
        },
      }

    case 'DEMO_FAIL_NEXT':
      return { ...state, demo: { ...state.demo, failNext: action.value } }

    case 'DEMO_CLEAR':
      return { ...state, issues: [], refill: makeSeed().issues, ingest: { postsToday: 0, newSinceOpen: 0 } }

    case 'RESET':
      return makeSeed()

    default:
      return state
  }
}

