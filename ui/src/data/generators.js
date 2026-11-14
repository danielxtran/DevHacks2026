// Deterministic "agent output" generators. In the real system these come from
// Agent 2 (spec), Agent 3 (build) and the playtest bots. Here they derive
// realistic, internally consistent artifacts from each issue's change descriptor.

import { tagInfo } from './constants'

// ---------- small utils ----------
function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function rng(seed) {
  let a = typeof seed === 'number' ? seed : hash(String(seed))
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gauss(r) {
  const u = Math.max(r(), 1e-9)
  const v = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const fmt = (n, unit = '') => `${round(n, 2)}${unit}`

// ---------- spec ----------
export function makeSpec(issue, overrides = {}) {
  const c = issue.change
  const after = overrides.after ?? c.proposed
  const systems = overrides.systems ?? [...c.systems]
  const phased = overrides.phased ?? false

  const direction = after < c.before ? 'Reduce' : 'Increase'
  const plan = phased
    ? [
        `Phase 1: change \`${c.key}\` in \`${c.file}\` from ${fmt(c.before, c.unit)} to ${fmt(after, c.unit)} behind a feature flag`,
        `Phase 1: run ${c.metric.name.toLowerCase()} playtest (2,000 bot matches) and review`,
        ...(systems.includes('Tooltips') ? ['Phase 2: update tooltip and patch-notes strings to match'] : []),
        'Phase 2: remove the flag and ship once Phase 1 is verified',
      ]
    : [
        `Change \`${c.key}\` in \`${c.file}\` from ${fmt(c.before, c.unit)} to ${fmt(after, c.unit)}`,
        ...(systems.includes('Tooltips') ? ['Update tooltip strings so displayed numbers match the data'] : []),
        `Add a regression test pinning the new value`,
        `Run unit, lint, typecheck and a 50-match simulation smoke test`,
        `Hand off to playtest bots: 2,000 matches on the old build vs. the new build`,
      ]

  return {
    title: issue.title,
    problem: c.problem,
    change: `${direction} ${c.label} from ${fmt(c.before, c.unit)} to ${fmt(after, c.unit)}. ${c.rationale}`,
    param: { file: c.file, key: c.key, before: c.before, after, unit: c.unit },
    systems,
    plan,
    risks: overrides.risks ?? [...c.risks],
    metrics: [
      `${c.metric.name} moves into ${c.metric.target[0]}–${c.metric.target[1]}${c.metric.unit} (currently ${c.metric.before}${c.metric.unit})`,
      ...(c.secondary || []).map((s) => `${s.name} does not regress by more than ${s.tolerance}${s.unit}`),
    ],
    summary: [
      `${direction} ${c.label}: ${fmt(c.before, c.unit)} → ${fmt(after, c.unit)}`,
      `Touches ${systems.length} system${systems.length === 1 ? '' : 's'}: ${systems.join(', ')}`,
      `Success = ${c.metric.name.toLowerCase()} within ${c.metric.target[0]}–${c.metric.target[1]}${c.metric.unit}`,
    ],
  }
}

export function specToText(spec) {
  const list = (xs) => xs.map((x) => `- ${x}`).join('\n')
  return [
    `# ${spec.title}`,
    '',
    '## Problem',
    spec.problem,
    '',
    '## Proposed change',
    spec.change,
    `Parameter: ${spec.param.key} = ${spec.param.after}${spec.param.unit} (was ${spec.param.before}${spec.param.unit})`,
    '',
    '## Affected systems',
    list(spec.systems),
    '',
    '## Architecture & build plan',
    list(spec.plan),
    '',
    '## Risks',
    list(spec.risks),
    '',
    '## Success metrics',
    list(spec.metrics),
  ].join('\n')
}

// Interpret a reviewer instruction and produce a revised spec + agent reply.
export function reviseSpec(issue, spec, message) {
  const c = issue.change
  const msg = message.toLowerCase()
  const cur = spec.param.after
  let after = cur
  let systems = [...spec.systems]
  let risks = [...spec.risks]
  let phased = spec.plan.some((p) => p.startsWith('Phase'))
  const did = []

  if (/smaller|softer|less|lighter|gentler|tone (it )?down/.test(msg)) {
    after = round(c.before + (cur - c.before) / 2)
    did.push(`halved the size of the change (${fmt(cur, c.unit)} → ${fmt(after, c.unit)})`)
  } else if (/bigger|harder|stronger|more aggressive|larger/.test(msg)) {
    after = round(c.before + (cur - c.before) * 1.5)
    did.push(`increased the size of the change (${fmt(cur, c.unit)} → ${fmt(after, c.unit)})`)
  }

  const dont = msg.match(/(?:don'?t|do not|never) (?:touch|change|modify) ([a-z ]+)|leave ([a-z ]+?) alone|without (?:touching )?([a-z ]+)/)
  if (dont) {
    const word = (dont[1] || dont[2] || dont[3]).trim().split(' ')[0]
    const removed = systems.filter((s) => s.toLowerCase().includes(word))
    systems = systems.filter((s) => !s.toLowerCase().includes(word))
    risks = [...risks, `Constraint from reviewer: do not modify ${word}.`]
    did.push(
      removed.length
        ? `removed ${removed.join(', ')} from scope and added a constraint`
        : `added a constraint to leave ${word} untouched (it wasn't in scope)`,
    )
  }

  if (/split|phase|two steps|stage it/.test(msg)) {
    phased = true
    did.push('split the build plan into two phases')
  }

  if (!did.length) {
    risks = [...risks, `Reviewer note addressed: “${message.trim()}”`]
    did.push('recorded your note under Risks and kept the parameters the same')
  }

  const next = makeSpec(issue, { after, systems, phased, risks })
  return { spec: next, reply: `Rewrote the spec: ${did.join('; ')}.` }
}

// ---------- build ----------
function setPath(obj, path, value) {
  const clone = JSON.parse(JSON.stringify(obj))
  const keys = path.split('.')
  let o = clone
  keys.slice(0, -1).forEach((k) => (o = o[k]))
  o[keys.at(-1)] = value
  return clone
}

export function makeBuild(issue, spec, attempt) {
  const c = issue.change
  const p = spec.param
  const failsTooltip = c.firstBuildFails && attempt === 1 && spec.systems.includes('Tooltips')

  const files = [
    {
      path: c.file,
      oldValue: JSON.stringify(setPath(c.context, c.key, p.before), null, 2),
      newValue: JSON.stringify(setPath(c.context, c.key, p.after), null, 2),
    },
  ]
  if (c.tooltip && spec.systems.includes('Tooltips')) {
    const oldTip = c.tooltip.replace('{v}', p.before)
    const newTip = c.tooltip.replace('{v}', failsTooltip ? p.before : p.after)
    files.push({
      path: 'game/locale/en/tooltips.json',
      oldValue: `{\n  "${c.tooltipKey}": "${oldTip}"\n}`,
      newValue: `{\n  "${c.tooltipKey}": "${newTip}"\n}`,
    })
  }
  const testName = c.key.split('.').at(-1)
  files.push({
    path: `tests/${c.file.split('/').at(-1).replace('.json', '')}.test.ts`,
    oldValue: '',
    newValue: [
      `import { load } from '../game/data'`,
      ``,
      `test('${testName} matches approved spec', () => {`,
      `  expect(load('${c.file}').${c.key}).toBe(${p.after})`,
      `})`,
    ].join('\n'),
  })

  const r = rng(`${issue.id}-build-${attempt}`)
  const total = 180 + Math.floor(r() * 60)
  const checks = [
    { name: 'Unit tests', status: 'pass', detail: `${total}/${total} passed` },
    { name: 'Lint', status: 'pass', detail: '0 problems' },
    { name: 'Typecheck', status: 'pass', detail: 'No errors' },
    failsTooltip
      ? {
          name: 'Tooltip ↔ data sync',
          status: 'fail',
          detail: `tooltips.json still says ${p.before}${p.unit} but ${c.key} is ${p.after}${p.unit}`,
        }
      : { name: 'Tooltip ↔ data sync', status: 'pass', detail: 'All displayed numbers match data' },
    { name: 'Sim smoke test (50 matches)', status: 'pass', detail: 'No crashes, no desyncs' },
  ]

  return {
    attempt,
    agentClaim: `Done. Changed ${c.key} from ${p.before}${p.unit} to ${p.after}${p.unit} in ${c.file} and added a regression test. Ready for playtest.`,
    files,
    checks,
    checksPassed: checks.every((ch) => ch.status === 'pass'),
    branch: `agent/${issue.id}-${testName.replace(/_/g, '-')}-v${attempt}`,
  }
}

export function buildScript(issue, spec, attempt) {
  const c = issue.change
  const p = spec.param
  return [
    `Checking out ${issue.game.toLowerCase()}@main`,
    `Creating branch agent/${issue.id}-v${attempt}`,
    `Reading approved spec v${issue.specVersions.length}`,
    `Editing ${c.file}: ${c.key} ${p.before} → ${p.after}`,
    ...(attempt > 1 && c.tooltip ? ['Previous attempt failed the tooltip sync check — updating tooltip strings to match data'] : []),
    'Writing regression test',
    'Running unit tests…',
    'Running lint and typecheck…',
    'Running tooltip ↔ data sync check…',
    'Running 50-match simulation smoke test…',
    'Agent reports: done.',
  ]
}

export function specScript(issue) {
  const c = issue.change
  return [
    `Reading ${issue.mentions.toLocaleString()} clustered posts for “${issue.title}”`,
    `Pulling live stat: ${issue.stat.label}`,
    `Locating config: ${c.file}`,
    `Tracing dependencies: ${c.systems.join(', ')}`,
    'Drafting proposed change',
    'Writing architecture & build plan',
    'Listing risks',
    'Defining success metrics',
    'Spec v1 ready for human review',
  ]
}

export function reviseScript(message) {
  return [`Reading reviewer instruction: “${message.trim().slice(0, 80)}”`, 'Revising affected sections', 'Re-checking success metrics', 'New version ready']
}

export function playtestScript(matches) {
  const batches = Math.max(2, Math.min(10, Math.round(matches / 200)))
  return [
    'Provisioning bot pool (old build + new build)',
    ...Array.from({ length: batches }, (_, i) => `Batch ${i + 1}/${batches}: ${Math.round(((i + 1) / batches) * matches).toLocaleString()} / ${matches.toLocaleString()} matches`),
    'Aggregating metrics and confidence intervals',
  ]
}

// ---------- playtest ----------
export function makePlaytest(issue, spec, matches, runNo = 1) {
  const c = issue.change
  const m = c.metric
  const r = rng(`${issue.id}-pt-${matches}-${runNo}-${spec.param.after}`)
  const mid = (m.target[0] + m.target[1]) / 2
  const eff = Math.max(-0.5, Math.min(1.6, (spec.param.after - c.before) / (c.ideal - c.before || 1)))
  const trueAfter = m.before + (mid - m.before) * eff * (m.responsiveness ?? 1)
  const se = m.sd / Math.sqrt(matches)

  const beforeObs = round(m.before + gauss(r) * se, 1)
  const afterObs = round(trueAfter + gauss(r) * se, 1)
  const ci = round(1.96 * se, 1)

  const batches = Math.max(2, Math.min(20, Math.round(matches / 100)))
  const series = Array.from({ length: batches }, (_, i) => {
    const n = ((i + 1) / batches) * matches
    const s = m.sd / Math.sqrt(n)
    const shrink = (batches - i - 1) / batches
    return {
      matches: Math.round(n),
      before: round(beforeObs + gauss(r) * s * shrink, 1),
      after: round(afterObs + gauss(r) * s * shrink, 1),
    }
  })

  const secondary = (c.secondary || []).map((s) => {
    const sb = round(s.before + gauss(r) * s.sd / Math.sqrt(matches), 1)
    const sa = round(s.before + s.delta * eff + gauss(r) * s.sd / Math.sqrt(matches), 1)
    return { name: s.name, unit: s.unit, before: sb, after: sa, ci: round((1.96 * s.sd) / Math.sqrt(matches), 1) }
  })

  // Verdicts
  const live = issue.stat.value
  const complaintSupported = live < m.target[0] || live > m.target[1]
  const diff = afterObs - beforeObs
  const significant = Math.abs(diff) > 1.96 * se * Math.SQRT2
  const inTarget = afterObs >= m.target[0] && afterObs <= m.target[1]
  const closer = Math.abs(afterObs - mid) < Math.abs(beforeObs - mid)
  let movement
  if (!significant) movement = 'inconclusive'
  else if (inTarget) movement = 'reached'
  else if (closer) movement = 'improved'
  else movement = 'worse'

  const reasons = [
    complaintSupported
      ? `Live data backs the complaint: ${issue.stat.label} is ${live}${issue.stat.unit}, outside the ${m.target[0]}–${m.target[1]}${m.unit} target.`
      : `Live data does not back the complaint: ${issue.stat.label} is ${live}${issue.stat.unit}, already inside the ${m.target[0]}–${m.target[1]}${m.unit} target.`,
  ]
  if (movement === 'inconclusive')
    reasons.push(
      `The change of ${round(diff, 1)}${m.unit} is within noise (±${round(1.96 * se * Math.SQRT2, 1)}${m.unit} needed).` +
        (matches < 1000 ? ` ${matches} matches is too small a sample; re-run with more matches.` : ''),
    )
  else if (movement === 'reached') reasons.push(`${m.name} moved ${beforeObs} → ${afterObs}${m.unit}, inside the target range.`)
  else if (movement === 'improved') reasons.push(`${m.name} moved ${beforeObs} → ${afterObs}${m.unit}: toward the target but not inside it yet.`)
  else reasons.push(`${m.name} moved ${beforeObs} → ${afterObs}${m.unit}: away from the target.`)

  let overall
  if (!complaintSupported) overall = 'not_supported'
  else if (movement === 'inconclusive') overall = 'inconclusive'
  else if (movement === 'reached') overall = 'supported'
  else overall = movement === 'improved' ? 'partial' : 'failed'

  // Simulated-player view (spec 6.2.3): win rate per team comp, damage, time alive.
  const tags = issue.tags ?? []
  // First named unit or item (not an ability or skin) gives the comp its name.
  const named = tags.map(tagInfo).find((t) => t && t.family === 'specific' && (t.target === 'unit' || t.target === 'item') && !t.part)
  const dir = tags.some((t) => /nerf/.test(t)) ? -1 : tags.some((t) => /buff/.test(t)) ? 1 : 0
  const comps = [named ? `${named.label} comp` : 'Meta comp', 'Bruiser comp', 'Mage comp', 'Reroll comp', 'Fast 8']
  const noise = (sd) => gauss(r) * sd / Math.sqrt(matches / 400)
  // If the headline metric is this unit's win rate, the comp bar uses the same numbers so they never disagree.
  const sameMetric = named && /win rate/i.test(m.name) && m.name.toLowerCase().includes(named.label.toLowerCase())
  const primaryBefore = sameMetric ? beforeObs : round(dir < 0 ? 57 + r() * 4 : dir > 0 ? 42 + r() * 3 : 49 + r() * 3, 1)
  const primaryAfter = sameMetric ? afterObs : round(primaryBefore + (50.5 - primaryBefore) * Math.min(1.2, Math.max(0, eff)) + noise(0.8), 1)
  const shift = (primaryBefore - primaryAfter) / (comps.length - 1)
  const compWinRates = comps.map((comp, k) => {
    if (k === 0) return { comp, before: primaryBefore, after: primaryAfter }
    const before = round(47 + r() * 6, 1)
    return { comp, before, after: round(before + shift + noise(0.7), 1) }
  })
  const dmgBefore = round(58 + r() * 8, 1)
  const aliveBefore = Math.round(1480 + r() * 160)

  return {
    runNo,
    matches,
    botsPerMatch: 8,
    compWinRates,
    avgDamage: { before: dmgBefore, after: round(dmgBefore + dir * 1.4 * Math.max(0, eff) + noise(0.5), 1) },
    avgTimeAlive: { before: aliveBefore, after: Math.round(aliveBefore - dir * 14 * Math.max(0, eff) + noise(6)) },
    metric: { name: m.name, unit: m.unit, target: m.target, before: beforeObs, after: afterObs, ci },
    secondary,
    series,
    complaintSupported,
    movement,
    overall,
    reasons,
  }
}

// ---------- evidence posts ----------
// The full cluster behind an issue: the hand-picked quotes first, then generated
// posts so the total per source matches the issue's mention counts. Deterministic per issue.
const POST_TEMPLATES = [
  (t) => `${t}. Been like this since the patch.`,
  (t) => `Is anyone else seeing this? ${t}.`,
  (t) => `+1. ${t}.`,
  (t) => `Clip from last night: ${t.toLowerCase()}. Not fun to play against.`,
  (t, g) => `Honestly “${t.toLowerCase()}” is the only thing ruining ${g} for me right now.`,
  (t) => `Devs please look at this: ${t.toLowerCase()}`,
  (t) => `Not sure it's that bad? ${t} only happens sometimes for me.`,
  (t) => `Reported it in-game too. ${t}.`,
  (t) => `Three games in a row now. ${t}.`,
  (t) => `${t}. Ranked is miserable until this gets fixed.`,
  (t) => `Can confirm. ${t}, tested in a custom lobby.`,
  (t) => `hot take: ${t.toLowerCase()} is overblown, people just need to adapt`,
]
const HANDLE_A = ['quiet', 'ember', 'lantern', 'tidal', 'paper', 'still', 'moss', 'iron', 'cinder', 'north', 'salt', 'velvet', 'hollow', 'glass', 'static']
const HANDLE_B = ['fox', 'main', 'carto', 'otter', 'wren', 'gg', 'ttv', 'kid', 'moth', 'rail', 'smith', 'harbor', 'drift', 'byte', 'lane']

export function makeClusterPosts(issue) {
  const posts = issue.evidence.map((p) => ({ ...p, pinned: true }))
  const seededBySource = {}
  for (const p of posts) seededBySource[p.source] = (seededBySource[p.source] || 0) + 1
  const anchor = new Date(issue.lastMention).getTime()
  const spanH = Math.max(24, (anchor - new Date(issue.firstSeen).getTime()) / 3600000)
  const subject = issue.title.replace(/[.’']+$/, '')
  for (const [source, count] of Object.entries(issue.sources)) {
    const need = Math.max(0, count - (seededBySource[source] || 0))
    for (let k = 0; k < need; k++) {
      const r = rng(`${issue.id}-post-${source}-${k}`)
      const name = `${HANDLE_A[Math.floor(r() * HANDLE_A.length)]}${source === 'x' ? '_' : ''}${HANDLE_B[Math.floor(r() * HANDLE_B.length)]}${Math.floor(r() * 99)}`
      const likes = Math.floor(Math.pow(r(), 3) * 900)
      posts.push({
        id: `${issue.id}-${source}-${k}`,
        source,
        author: source === 'reddit' ? `u/${name}` : `@${name}`,
        text: POST_TEMPLATES[Math.floor(r() * POST_TEMPLATES.length)](subject, issue.game),
        ts: new Date(anchor - Math.pow(r(), 1.6) * spanH * 3600000).toISOString(),
        engagement: { likes, replies: Math.floor(likes * (0.05 + r() * 0.25)) },
      })
    }
  }
  return posts
}
