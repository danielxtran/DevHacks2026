// Shared vocabulary for the pipeline UI.

export const STAGES = [
  { id: 'feedback', label: 'Feedback' },
  { id: 'spec', label: 'Spec' },
  { id: 'playtest', label: 'Playtest' },
  { id: 'verified', label: 'Verified' },
]

// Work Board columns. Each column groups one or more pipeline stages.
// The build runs in the background at the start of Playtest, so it has no column of its own.
// Closed also holds rejected (dismissed) issues.
export const BOARD = [
  { id: 'issues', label: 'Issues', stages: ['feedback'] },
  { id: 'development', label: 'Development', stages: ['spec'] },
  { id: 'testing', label: 'Testing', stages: ['playtest'] },
  { id: 'closed', label: 'Closed', stages: ['verified'] },
]

export const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]))

// Status of the issue within its current stage.
export const STATUSES = {
  queued: { label: 'Queued', icon: '○', tone: 'muted' },
  running: { label: 'Agent running', icon: '◐', tone: 'info' },
  needs_review: { label: 'Needs review', icon: '◆', tone: 'accent' },
  approved: { label: 'Approved', icon: '✓', tone: 'success' },
  rejected: { label: 'Rejected', icon: '✕', tone: 'muted' },
  error: { label: 'Error', icon: '!', tone: 'warning' },
  done: { label: 'Verified', icon: '✓', tone: 'success' },
}

export const AGENTS = {
  collector: { id: 'collector', name: 'Agent 1 · Collector', short: 'Collector' },
  spec: { id: 'spec', name: 'Agent 2 · Spec Writer', short: 'Spec Writer' },
  build: { id: 'build', name: 'Agent 3 · Builder', short: 'Builder' },
  playtest: { id: 'playtest', name: 'Playtest Bots', short: 'Playtest Bots' },
}

// Tags on issues. Two families:
// - Fix-type tags: tinted pills. Color = what the fix targets; icon = direction (buff ↑, nerf ↓, adjust ↔).
// - Specific tags: neutral pills with a dot in their target's color (which unit, trait, item, system…).
// Names come from the demo games (Shardfall units and roles, Tidebreak weapons).
export const TARGETS = {
  unit: { label: 'Unit', color: '#4A8FE7' },
  trait: { label: 'Trait', color: '#A06CE0' },
  item: { label: 'Item', color: '#D4A43A' },
  augment: { label: 'Augment', color: '#2BAE97' },
  system: { label: 'System', color: '#8D8A85' },
  bug: { label: 'Bug fix', color: '#E0588E' },
}
export const DIRECTIONS = { buff: '↑', nerf: '↓', adjust: '↔', change: '⚙', fix: '✓' }

const slug = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const fix = (target, dir, label) => [slug(label), { label, family: 'fix', target, dir }]
const spec = (target, part) => (label) => [slug(label), { label, family: 'specific', target, ...(part && { part }) }]
export const TAGS = Object.fromEntries([
  ...['unit', 'trait', 'item', 'augment'].flatMap((t) =>
    ['buff', 'nerf', 'adjust'].map((d) => fix(t, d, `${TARGETS[t].label} ${d}`)),
  ),
  fix('system', 'change', 'System change'),
  fix('bug', 'fix', 'Bug fix'),
  // Units and their abilities/cosmetics
  ...['Ironvane', 'Kestrel', 'Solenne', 'Brakk'].map(spec('unit')),
  ...['Shield Bash', 'Skyward Dash', 'Radiance'].map(spec('unit', 'ability')),
  ...['Ember skin'].map(spec('unit', 'skin')),
  // Traits (unit roles)
  ...['Vanguard', 'Skirmisher', 'Support'].map(spec('trait')),
  // Items
  ...['Harpoon', 'Scattergun'].map(spec('item')),
  // Augments
  ...['Econ augments'].map(spec('augment')),
  // Systems
  ...['Map', 'Economy', 'Ranked', 'Matchmaking', 'Netcode', 'VFX', 'UI', 'Performance', 'Bench'].map(spec('system')),
])

// Specific tags typed in by hand are stored as "custom:<target>:<label>".
export const customTagId = (target, label) => `custom:${target}:${label.trim()}`
export function tagInfo(id) {
  if (TAGS[id]) return TAGS[id]
  const m = /^custom:(\w+):(.+)$/.exec(id)
  return m && TARGETS[m[1]] ? { label: m[2], family: 'specific', target: m[1], custom: true } : null
}
/** Catalog id for a typed label, or a custom specific tag if it isn't in the catalog. Fix types must come from the catalog. */
export function resolveTag(family, target, label) {
  const want = label.trim().toLowerCase()
  const hit = Object.entries(TAGS).find(([, t]) => t.family === family && (family === 'fix' || t.target === target) && t.label.toLowerCase() === want)
  if (hit) return hit[0]
  return family === 'fix' ? null : customTagId(target, label)
}

// Fix types first, then specific tags; each grouped by target in TARGETS order, then catalog order.
const TARGET_ORDER = Object.fromEntries(Object.keys(TARGETS).map((k, n) => [k, n]))
export function sortTags(ids) {
  const all = Object.keys(TAGS)
  const pos = (id) => (TAGS[id] ? all.indexOf(id) : all.length)
  const key = (id) => {
    const t = tagInfo(id)
    return (t.family === 'fix' ? 0 : 100) + TARGET_ORDER[t.target]
  }
  return ids.filter((t) => tagInfo(t)).sort((x, y) => key(x) - key(y) || pos(x) - pos(y))
}

// Devs who can be assigned to issues (the teammates in the demo data).
export const DEVS = {
  dev: { name: 'Dev' },
  jun: { name: 'Jun' },
  marco: { name: 'Marco' },
  ana: { name: 'Ana' },
  priya: { name: 'Priya' },
}
export const devLabel = (id) => DEVS[id]?.name ?? id

export const SOURCES = {
  reddit: { label: 'Reddit', glyph: 'r/' },
  x: { label: 'X', glyph: 'X' },
}

export const GAMES = ['Shardfall', 'Tidebreak', 'Hexlab']

export const ME = 'You'
