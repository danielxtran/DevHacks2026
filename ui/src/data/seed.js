// Realistic seeded data. Games, units and players are fictional.
// The demo uses seeded feedback for platforms we
// don't scrape live, and says so in the UI.

import { makeSpec, makeBuild, makePlaytest, rng, specScript, buildScript } from './generators'

const H = 3600 * 1000
const ago = (hours) => new Date(Date.now() - hours * H).toISOString()

function trend(id, base, slope) {
  const r = rng(`trend-${id}`)
  return Array.from({ length: 14 }, (_, i) => Math.max(0, Math.round(base + slope * i + (r() - 0.5) * base * 0.35)))
}

const ironvaneChange = {
  label: 'Ironvane Shield Bash stun duration',
  problem:
    'Players across every platform report that Ironvane’s Shield Bash stun is too long to react to. Live data agrees: Ironvane wins 56.8% of matches against a 50% average, the highest of any unit this patch.',
  rationale: 'A 1.0s stun keeps the combo threat but gives the target time to respond.',
  file: 'game/units/ironvane.json',
  key: 'shield_bash.stun_duration',
  before: 1.5,
  proposed: 1.0,
  ideal: 1.0,
  unit: 's',
  systems: ['Unit stats', 'Combat resolver', 'Tooltips'],
  risks: ['Ironvane may drop below viability in low ranks', 'Stun-chain comps (Ironvane + Moth) lose a lot of power at once'],
  metric: { name: 'Ironvane win rate', unit: '%', before: 56.8, target: [48, 52], sd: 50 },
  secondary: [
    { name: 'Avg match length', unit: ' min', before: 14.2, delta: 0.4, sd: 3, tolerance: 1 },
    { name: 'Stun uptime per match', unit: 's', before: 11.8, delta: -3.9, sd: 6, tolerance: 0 },
  ],
  context: { id: 'ironvane', role: 'vanguard', base_hp: 720, shield_bash: { damage: 60, stun_duration: 1.5, cooldown: 8 } },
  tooltip: 'Bashes the target for 60 damage and stuns for {v}s.',
  tooltipKey: 'ironvane.shield_bash',
  firstBuildFails: true,
}

function baseIssue(o) {
  return {
    dismissed: false,
    mergedInto: null,
    mergedFrom: [],
    comments: [],
    specVersions: [],
    chat: [],
    build: null,
    builds: [],
    playtest: null,
    run: null,
    error: null,
    approvals: {},
    ...o,
  }
}

function version(v, author, spec, note, hoursAgo) {
  return { v, author, authorName: author === 'agent' ? 'Spec Writer' : 'You', spec, note, ts: ago(hoursAgo) }
}

export function makeSeed() {
  const issues = []

  // 1 — the demo issue: starts at the very beginning of the pipeline.
  issues.push(
    baseIssue({
      id: 'iss-101',
      game: 'Shardfall',
      title: 'Ironvane’s Shield Bash stun lasts too long',
      summary:
        'Players say the 1.5s stun on Shield Bash leaves no counterplay, especially when chained with other crowd control. Most posts mention losing fights before they can react.',
      stage: 'feedback',
      status: 'queued',
      mentions: 2184,
      firstSeen: ago(14 * 24),
      lastMention: ago(0.1),
      trend: trend('101', 60, 14),
      sources: { reddit: 812, x: 640 },
      stat: { label: 'Ironvane win rate', value: 56.8, baseline: 50.0, unit: '%', note: 'All ranks · last 7 days · 41,200 matches' },
      change: ironvaneChange,
      evidence: [
        { id: 'e1', source: 'reddit', author: 'u/quietcartographer', text: 'Ironvane bash → stun → I’m dead. 1.5 seconds is an eternity in a 14-minute game. There is literally nothing to play around.', ts: ago(5), engagement: { likes: 1843, replies: 312 } },
        { id: 'e2', source: 'x', author: '@lanternfox_gg', text: 'every ranked game this week: enemy picks ironvane, we lose the first fight to a stun we couldn’t react to. please look at shield bash', ts: ago(9), engagement: { likes: 921, replies: 88 } },
        { id: 'e3', source: 'reddit', author: 'u/stillwater_vanguard', text: 'I main Ironvane and even I think the stun is too long. The kit is fine, the 1.5s is the problem.', ts: ago(20), engagement: { likes: 1102, replies: 230 } },
        { id: 'e4', source: 'x', author: '@moss_and_static', text: 'Ironvane isn’t overtuned in damage, it’s the stun length. Cut it and he’s fine.', ts: ago(30), engagement: { likes: 264, replies: 41 } },
      ],
      comments: [
        { id: 'c1', author: 'Priya', text: 'Volume tripled since the patch dropped. Flagging for @Dev.', ts: ago(26) },
      ],
      audit: [
        { ts: ago(14 * 24), kind: 'agent', actor: 'Collector', text: 'Created cluster from 38 similar posts' },
        { ts: ago(26), kind: 'human', actor: 'Priya', text: 'Tagged Balance' },
        { ts: ago(0.1), kind: 'agent', actor: 'Collector', text: 'Merged 24 new posts into cluster' },
      ],
    }),
  )

  // 2 — spec waiting on a human
  const kestrel = {
    label: 'Kestrel dash wall collision margin',
    problem: 'Kestrel’s Skyward Dash can pass through thin walls on narrow maps (Hollowmere, Saltway). Telemetry logs 3.4 wall-clips per 100 matches; it should be ~0.',
    rationale: 'A 0.25-unit collision margin stops the dash at thin walls without shortening it in open space.',
    file: 'game/units/kestrel.json',
    key: 'skyward_dash.collision_margin',
    before: 0,
    proposed: 0.25,
    ideal: 0.25,
    unit: 'u',
    systems: ['Unit stats', 'Physics / collision', 'Map geometry'],
    risks: ['Dash may stop short near pillars that look passable', 'Map geometry teams may need to thicken some walls instead'],
    metric: { name: 'Wall-clips per 100 matches', unit: '', before: 3.4, target: [0, 0.5], sd: 18 },
    secondary: [{ name: 'Kestrel dash success rate', unit: '%', before: 97, delta: -1.4, sd: 17, tolerance: 3 }],
    context: { id: 'kestrel', role: 'skirmisher', skyward_dash: { range: 6, collision_margin: 0, cooldown: 10 } },
  }
  const kestrelIssue = baseIssue({
    id: 'iss-102',
    game: 'Shardfall',
    title: 'Kestrel’s dash clips through walls on narrow maps',
    summary: 'Reports and clips show Kestrel dashing through thin walls on Hollowmere and Saltway, escaping fights that should be over.',
    stage: 'spec',
    status: 'needs_review',
    mentions: 1420,
    firstSeen: ago(9 * 24),
    lastMention: ago(1.5),
    trend: trend('102', 80, 6),
    sources: { reddit: 690, x: 410 },
    stat: { label: 'Wall-clips per 100 matches', value: 3.4, baseline: 0, unit: '', note: 'Server telemetry · last 7 days' },
    change: kestrel,
    evidence: [
      { id: 'e1', source: 'reddit', author: 'u/brightwater_main', text: '[clip] Kestrel dashed through the Hollowmere mid wall and walked away at 20 hp. This happens constantly.', ts: ago(7), engagement: { likes: 2210, replies: 190 } },
      { id: 'e2', source: 'x', author: '@saltwaysiren', text: 'saltway east wall is a door if you’re kestrel apparently', ts: ago(15), engagement: { likes: 480, replies: 32 } },
          ],
    comments: [
      { id: 'c1', author: 'Marco', text: 'Confirmed repro on Hollowmere. @Ana can you check whether this is client prediction or server-side?', ts: ago(40) },
      { id: 'c2', author: 'Ana', text: 'Server-side. The server accepts the dash end position. Not our bug, but happy to review.', ts: ago(36) },
    ],
    audit: [
      { ts: ago(9 * 24), kind: 'agent', actor: 'Collector', text: 'Created cluster from 22 similar posts' },
      { ts: ago(40), kind: 'human', actor: 'Marco', text: 'Tagged Gameplay, Netcode' },
      { ts: ago(3), kind: 'human', actor: 'Marco', text: 'Sent to Spec Writer' },
      { ts: ago(2.9), kind: 'agent', actor: 'Spec Writer', text: 'Wrote spec v1' },
    ],
  })
  kestrelIssue.specVersions = [version(1, 'agent', makeSpec(kestrelIssue), 'Initial draft', 2.9)]
  kestrelIssue.chat = [{ role: 'agent', text: 'Spec v1 is ready. I scoped it to a collision margin change rather than editing map geometry. Tell me what to change, or edit the spec directly.', ts: ago(2.9) }]
  issues.push(kestrelIssue)

  // 3 — build agent running
  const queue = {
    label: 'OCE off-peak MMR widening rate',
    problem: 'OCE players report 6+ minute queues off-peak. Median off-peak queue is 372s against a 180s target.',
    rationale: 'Widening the MMR search faster off-peak trades a little match quality for much shorter queues.',
    file: 'services/matchmaking/regions/oce.json',
    key: 'offpeak.mmr_widen_rate',
    before: 25,
    proposed: 60,
    ideal: 60,
    unit: ' MMR/min',
    systems: ['Matchmaking service', 'Region config'],
    risks: ['Wider MMR gaps → more one-sided matches', 'Could leak into peak hours if the off-peak window is misconfigured'],
    metric: { name: 'Simulated median queue time', unit: 's', before: 372, target: [90, 180], sd: 140 },
    secondary: [{ name: 'Avg MMR gap per match', unit: '', before: 64, delta: 38, sd: 40, tolerance: 50 }],
    context: { region: 'oce', peak: { mmr_widen_rate: 15 }, offpeak: { start_hour: 1, end_hour: 9, mmr_widen_rate: 25 } },
  }
  const queueIssue = baseIssue({
    id: 'iss-103',
    game: 'Shardfall',
    title: 'Queue times over 6 minutes in OCE off-peak',
    summary: 'Oceania players queueing between 1am and 9am local wait 6+ minutes, and some give up.',
    stage: 'playtest',
    status: 'running',
    mentions: 860,
    firstSeen: ago(21 * 24),
    lastMention: ago(4),
    trend: trend('103', 55, 1),
    sources: { reddit: 430, x: 260 },
    stat: { label: 'OCE off-peak median queue', value: 372, baseline: 180, unit: 's', note: 'Matchmaking logs · last 14 days' },
    change: queue,
    evidence: [
      { id: 'e1', source: 'reddit', author: 'u/antipodean_tank', text: '7 minute queue at 2am Sydney time. I alt-tabbed and missed the accept. Back to 7 minutes.', ts: ago(30), engagement: { likes: 640, replies: 120 } },
      { id: 'e2', source: 'x', author: '@oce_queue_watch', text: 'Polled 1,200 OCE players: 71% say queue time is their #1 problem right now.', ts: ago(60), engagement: { likes: 312, replies: 88 } },
    ],
    audit: [
      { ts: ago(21 * 24), kind: 'agent', actor: 'Collector', text: 'Created cluster from 15 similar posts' },
      { ts: ago(30), kind: 'agent', actor: 'Spec Writer', text: 'Wrote spec v1' },
      { ts: ago(26), kind: 'human', actor: 'Jun', text: 'Edited spec → v2 (limited change to off-peak window)' },
      { ts: ago(25), kind: 'human', actor: 'Jun', text: 'Approved spec v2 and sent to Builder' },
    ],
  })
  const q1 = makeSpec(queueIssue)
  const q2 = { ...q1, risks: [...q1.risks, 'Peak-hour config must stay untouched (reviewer edit)'] }
  queueIssue.specVersions = [version(1, 'agent', q1, 'Initial draft', 30), { ...version(2, 'human', q2, 'Limited change to off-peak window', 26), authorName: 'Jun' }]
  queueIssue.approvals.spec = { by: 'Jun', ts: ago(25), v: 2 }
  queueIssue.run = { agent: 'build', kind: 'build', attempt: 1, startedAt: ago(0.004), script: buildScript(queueIssue, q2, 1), idx: 2 }
  issues.push(queueIssue)

  // 4 — playtest results waiting on a human; complaint NOT supported by data
  const solenne = {
    label: 'Solenne heal scaling',
    problem: 'A vocal group says Solenne’s healing “outscales everyone” late game. Her live win rate is 50.9%, inside the 48–52% band.',
    rationale: 'Lower late-game scaling while leaving early healing intact.',
    file: 'game/units/solenne.json',
    key: 'radiance.heal_scaling',
    before: 0.45,
    proposed: 0.38,
    ideal: 0.38,
    unit: '',
    systems: ['Unit stats', 'Tooltips'],
    risks: ['Could push Solenne below 48% if the complaint is perception rather than power'],
    metric: { name: 'Solenne win rate', unit: '%', before: 50.9, target: [48, 52], sd: 50 },
    secondary: [{ name: 'Healing done per match', unit: 'k', before: 18.4, delta: -2.1, sd: 6, tolerance: 3 }],
    context: { id: 'solenne', role: 'support', radiance: { base_heal: 40, heal_scaling: 0.45, cooldown: 12 } },
    tooltip: 'Heals allies for 40 (+{v} per level).',
    tooltipKey: 'solenne.radiance',
  }
  const solIssue = baseIssue({
    id: 'iss-104',
    game: 'Shardfall',
    title: 'Solenne’s healing outscales everyone late game',
    summary: 'Players say Solenne heals through any damage after the 12-minute mark.',
    stage: 'playtest',
    status: 'needs_review',
    mentions: 1105,
    firstSeen: ago(6 * 24),
    lastMention: ago(2),
    trend: trend('104', 70, 4),
    sources: { reddit: 520, x: 380 },
    stat: { label: 'Solenne win rate', value: 50.9, baseline: 50.0, unit: '%', note: 'All ranks · last 7 days · 38,900 matches' },
    change: solenne,
    evidence: [
      { id: 'e1', source: 'reddit', author: 'u/lowtide_ember', text: 'Solenne after 12 min is unkillable. Healing should not scale like this.', ts: ago(40), engagement: { likes: 930, replies: 410 } },
      { id: 'e2', source: 'x', author: '@paperlanterns', text: 'hot take: solenne is fine, people just don’t build anti-heal', ts: ago(50), engagement: { likes: 1210, replies: 260 } },
    ],
    comments: [{ id: 'c1', author: 'Dev', text: 'Win rate looks normal to me. Let the bots tell us.', ts: ago(20) }],
    audit: [
      { ts: ago(6 * 24), kind: 'agent', actor: 'Collector', text: 'Created cluster from 30 similar posts' },
      { ts: ago(22), kind: 'agent', actor: 'Spec Writer', text: 'Wrote spec v1' },
      { ts: ago(21), kind: 'human', actor: 'Dev', text: 'Approved spec v1' },
      { ts: ago(20.5), kind: 'agent', actor: 'Builder', text: 'Build attempt 1 finished — all checks passed. Playtest started.' },
      { ts: ago(19), kind: 'agent', actor: 'Playtest Bots', text: 'Ran 2,000 matches' },
    ],
  })
  const s1 = makeSpec(solIssue)
  solIssue.specVersions = [version(1, 'agent', s1, 'Initial draft', 22)]
  solIssue.approvals.spec = { by: 'Dev', ts: ago(21), v: 1 }
  solIssue.build = makeBuild(solIssue, s1, 1)
  solIssue.builds = [solIssue.build]
  solIssue.playtest = makePlaytest(solIssue, s1, 2000)
  issues.push(solIssue)

  // 5 — netcode, untriaged
  issues.push(
    baseIssue({
      id: 'iss-105',
      game: 'Tidebreak',
      title: 'Rubberbanding on 120ms+ connections',
      summary: 'Players on higher-ping connections snap backwards several times a minute, mostly while strafing.',
      stage: 'feedback',
      status: 'queued',
      mentions: 990,
      firstSeen: ago(4 * 24),
      lastMention: ago(0.6),
      trend: trend('105', 20, 9),
      sources: { reddit: 300, x: 450 },
      stat: { label: 'Position corrections / min (120ms+)', value: 9.2, baseline: 3, unit: '', note: 'Client telemetry · last 4 days' },
      change: {
        label: 'client interpolation buffer',
        problem: 'High-ping Tidebreak players get 9.2 position corrections per minute, against a target of ≤3.',
        rationale: 'A larger interpolation buffer smooths corrections at the cost of a little input latency.',
        file: 'client/net/interp.json',
        key: 'interp_buffer_ms',
        before: 50,
        proposed: 100,
        ideal: 100,
        unit: 'ms',
        systems: ['Netcode', 'Client prediction'],
        risks: ['Adds up to 50ms of perceived input latency'],
        metric: { name: 'Position corrections / min (sim 140ms)', unit: '', before: 9.2, target: [0, 3], sd: 40 },
        secondary: [{ name: 'Input latency', unit: 'ms', before: 62, delta: 28, sd: 30, tolerance: 30 }],
        context: { interp_buffer_ms: 50, extrapolation_limit_ms: 120 },
      },
      evidence: [
        { id: 'e1', source: 'x', author: '@driftwood_rail', text: 'tidebreak netcode on 130 ping is unplayable, rubberbanding every strafe', ts: ago(3), engagement: { likes: 770, replies: 64 } },
        { id: 'e2', source: 'reddit', author: 'u/southern_relay', text: 'Recorded 40 minutes: 11 snapbacks per minute on average. Video + netgraph in comments.', ts: ago(12), engagement: { likes: 1530, replies: 205 } },
      ],
      audit: [{ ts: ago(4 * 24), kind: 'agent', actor: 'Collector', text: 'Created cluster from 19 similar posts' }],
    }),
  )

  // 6 — art, untriaged
  issues.push(
    baseIssue({
      id: 'iss-106',
      game: 'Shardfall',
      title: 'Brakk’s Ember skin VFX hides his attack windup',
      summary: 'The new Ember skin’s flame particles cover Brakk’s windup animation, so players can’t see attacks coming.',
      stage: 'feedback',
      status: 'queued',
      mentions: 640,
      firstSeen: ago(3 * 24),
      lastMention: ago(1.1),
      trend: trend('106', 10, 8),
      sources: { reddit: 250, x: 190 },
      stat: { label: 'Ember skin win rate vs. base skin', value: 3.1, baseline: 0, unit: 'pp', note: '12,400 matches with skin' },
      change: {
        label: 'Ember skin windup VFX opacity',
        problem: 'Brakk wins 3.1 points more often with the Ember skin than without, which suggests a visibility advantage.',
        rationale: 'Lower particle opacity during windup frames so the animation reads clearly.',
        file: 'game/skins/brakk_ember.json',
        key: 'vfx.windup_opacity',
        before: 0.9,
        proposed: 0.55,
        ideal: 0.55,
        unit: '',
        systems: ['Skin VFX'],
        risks: ['Skin may feel less premium'],
        metric: { name: 'Ember skin win-rate gap', unit: 'pp', before: 3.1, target: [-1, 1], sd: 70 },
        context: { skin: 'brakk_ember', vfx: { windup_opacity: 0.9, idle_opacity: 0.6 } },
      },
      evidence: [{ id: 'e1', source: 'x', author: '@cindermoth', text: 'can’t see ember brakk’s windup AT ALL. pay to win skin lol', ts: ago(8), engagement: { likes: 410, replies: 52 } }],
      audit: [{ ts: ago(3 * 24), kind: 'agent', actor: 'Collector', text: 'Created cluster from 12 similar posts' }],
    }),
  )

  // 7 — fully verified
  const gold = {
    label: 'kill bounty scaling',
    problem: 'The team ahead at 8 minutes wins 78.4% of matches. Players say comebacks feel impossible.',
    rationale: 'Smaller bounty scaling slows snowballing without removing the reward for an early lead.',
    file: 'game/economy/bounties.json',
    key: 'kill.bounty_scaling',
    before: 1.25,
    proposed: 1.1,
    ideal: 1.1,
    unit: '×',
    systems: ['Economy', 'Tooltips'],
    risks: ['Early game may feel less rewarding'],
    metric: { name: 'Win rate of team ahead at 8 min', unit: '%', before: 78.4, target: [62, 70], sd: 41 },
    secondary: [{ name: 'Avg match length', unit: ' min', before: 13.1, delta: 1.2, sd: 3, tolerance: 2 }],
    context: { kill: { base_bounty: 300, bounty_scaling: 1.25, max_bounty: 1000 } },
  }
  const goldIssue = baseIssue({
    id: 'iss-107',
    game: 'Shardfall',
    title: 'An early gold lead almost always wins the game',
    summary: 'Players say once a team falls behind early there’s no realistic way back.',
    stage: 'verified',
    status: 'done',
    mentions: 1730,
    firstSeen: ago(30 * 24),
    lastMention: ago(10),
    trend: trend('107', 160, -9),
    sources: { reddit: 900, x: 500 },
    stat: { label: 'Win rate of team ahead at 8 min', value: 78.4, baseline: 66, unit: '%', note: 'All ranks · last 14 days' },
    change: gold,
    evidence: [{ id: 'e1', source: 'reddit', author: 'u/comeback_kid_99', text: 'Down 2k gold at 8 minutes = ff. Bounties don’t do enough.', ts: ago(200), engagement: { likes: 2400, replies: 530 } }],
    audit: [
      { ts: ago(30 * 24), kind: 'agent', actor: 'Collector', text: 'Created cluster' },
      { ts: ago(100), kind: 'agent', actor: 'Spec Writer', text: 'Wrote spec v1' },
      { ts: ago(98), kind: 'human', actor: 'Dev', text: 'Approved spec v1' },
      { ts: ago(97), kind: 'agent', actor: 'Builder', text: 'Build attempt 1 — all checks passed. Playtest started.' },
      { ts: ago(94), kind: 'agent', actor: 'Playtest Bots', text: 'Ran 2,000 matches' },
      { ts: ago(90), kind: 'human', actor: 'Dev', text: 'Marked verified' },
    ],
  })
  const g1 = makeSpec(goldIssue)
  goldIssue.specVersions = [version(1, 'agent', g1, 'Initial draft', 100)]
  goldIssue.approvals = { spec: { by: 'Dev', ts: ago(98), v: 1 }, playtest: { by: 'Dev', ts: ago(90) } }
  goldIssue.build = makeBuild(goldIssue, g1, 1)
  goldIssue.builds = [goldIssue.build]
  goldIssue.playtest = makePlaytest(goldIssue, g1, 2000)
  issues.push(goldIssue)

  // 8 — spec agent running
  const harpoon = {
    label: 'Harpoon close-range damage multiplier',
    problem: 'The Harpoon gets 31% of all kills in Tidebreak, against a 15–22% target for any one weapon.',
    rationale: 'Lower the close-range multiplier so the Harpoon stays strong at mid range but stops one-shotting up close.',
    file: 'game/weapons/harpoon.json',
    key: 'damage.close_range_multiplier',
    before: 1.8,
    proposed: 1.35,
    ideal: 1.35,
    unit: '×',
    systems: ['Weapon stats', 'Tooltips'],
    risks: ['Harpoon players may switch to the Scattergun, moving the problem'],
    metric: { name: 'Harpoon kill share', unit: '%', before: 31, target: [15, 22], sd: 46 },
    context: { weapon: 'harpoon', damage: { base: 70, close_range_multiplier: 1.8, falloff_start: 8 } },
    tooltip: 'Deals 70 damage ({v}× at close range).',
    tooltipKey: 'harpoon.damage',
  }
  const harpoonIssue = baseIssue({
    id: 'iss-108',
    game: 'Tidebreak',
    title: 'Harpoon one-shots at close range',
    summary: 'Players say the Harpoon kills in one hit up close and every lobby is full of it.',
    stage: 'spec',
    status: 'running',
    mentions: 1290,
    firstSeen: ago(5 * 24),
    lastMention: ago(0.3),
    trend: trend('108', 40, 10),
    sources: { reddit: 500, x: 520 },
    stat: { label: 'Harpoon kill share', value: 31, baseline: 18.5, unit: '%', note: 'All modes · last 5 days' },
    change: harpoon,
    evidence: [{ id: 'e1', source: 'reddit', author: 'u/kelpforest_sniper', text: 'Every lobby is 8 harpoons. One hit and you’re out. Please.', ts: ago(6), engagement: { likes: 1320, replies: 240 } }],
    audit: [
      { ts: ago(5 * 24), kind: 'agent', actor: 'Collector', text: 'Created cluster from 26 similar posts' },
      { ts: ago(0.01), kind: 'human', actor: 'You', text: 'Sent to Spec Writer' },
    ],
  })
  harpoonIssue.run = { agent: 'spec', kind: 'spec_initial', startedAt: ago(0.003), script: specScript(harpoonIssue), idx: 3 }
  issues.push(harpoonIssue)

  // 9 — lower-priority feedback
  issues.push(
    baseIssue({
      id: 'iss-109',
      game: 'Tidebreak',
      title: 'Ranked points lost on a loss feel bigger than points gained on a win',
      summary: 'Players at a 50% win rate say they still lose ranked points over time.',
      stage: 'feedback',
      status: 'queued',
      mentions: 410,
      firstSeen: ago(11 * 24),
      lastMention: ago(8),
      trend: trend('109', 30, 0),
      sources: { reddit: 220, x: 140 },
      stat: { label: 'Points lost ÷ points gained at 50% WR', value: 1.15, baseline: 1.0, unit: '×', note: 'Ranked ladder · last 30 days' },
      change: {
        label: 'ranked loss multiplier',
        problem: 'At a 50% win rate, players lose 1.15 points for every point they gain.',
        rationale: 'Make wins and losses symmetric at equal MMR.',
        file: 'services/ranked/ladder.json',
        key: 'loss_multiplier',
        before: 1.15,
        proposed: 1.0,
        ideal: 1.0,
        unit: '×',
        systems: ['Ranked service'],
        risks: ['Ladder inflation over a season'],
        metric: { name: 'Loss ÷ gain ratio at 50% WR', unit: '×', before: 1.15, target: [0.97, 1.03], sd: 0.9 },
        context: { win_base: 20, loss_multiplier: 1.15 },
      },
      evidence: [{ id: 'e1', source: 'reddit', author: 'u/fiftyfifty_forever', text: 'Tracked 200 games, 101 W 99 L, and I’m down 140 points. Something’s off.', ts: ago(30), engagement: { likes: 880, replies: 150 } }],
      audit: [{ ts: ago(11 * 24), kind: 'agent', actor: 'Collector', text: 'Created cluster' }],
    }),
  )

  // 10 — near-duplicate of #1, to show merging
  issues.push(
    baseIssue({
      id: 'iss-110',
      game: 'Shardfall',
      title: 'Ironvane stun is broken',
      summary: 'A smaller cluster of short posts about Ironvane’s stun. Likely the same issue as “Shield Bash stun lasts too long.”',
      stage: 'feedback',
      status: 'queued',
      mentions: 214,
      firstSeen: ago(2 * 24),
      lastMention: ago(0.8),
      trend: trend('110', 5, 2),
      sources: { reddit: 40, x: 120 },
      stat: { label: 'Ironvane win rate', value: 56.8, baseline: 50.0, unit: '%', note: 'All ranks · last 7 days' },
      change: ironvaneChange,
      evidence: [{ id: 'e1', source: 'x', author: '@pebble_sprint', text: 'ironvane stun broken pls fix', ts: ago(4), engagement: { likes: 92, replies: 6 } }],
      audit: [{ ts: ago(2 * 24), kind: 'agent', actor: 'Collector', text: 'Created cluster from 6 similar posts (possible duplicate of iss-101)' }],
    }),
  )

  // Assigned devs: the people already working on each issue in the demo data.
  const ASSIGNED = { 'iss-101': ['priya'], 'iss-102': ['marco', 'ana'], 'iss-103': ['jun'], 'iss-104': ['dev'], 'iss-107': ['dev'], 'iss-108': ['dev'] }
  for (const i of issues) i.devs = ASSIGNED[i.id] ?? []

  // Subject tags (ids from TAGS in constants.js).
  const TAGGED = {
    'iss-101': ['unit-nerf', 'ironvane', 'shield-bash', 'vanguard'],
    'iss-102': ['bug-fix', 'kestrel', 'skyward-dash', 'skirmisher', 'map'],
    'iss-103': ['system-change', 'matchmaking'],
    'iss-104': ['unit-nerf', 'solenne', 'radiance', 'support'],
    'iss-105': ['bug-fix', 'netcode'],
    'iss-106': ['bug-fix', 'brakk', 'ember-skin', 'vfx'],
    'iss-107': ['system-change', 'economy'],
    'iss-108': ['item-nerf', 'harpoon'],
    'iss-109': ['system-change', 'ranked'],
    'iss-110': ['unit-nerf', 'ironvane', 'shield-bash'],
  }
  for (const i of issues) i.tags = TAGGED[i.id] ?? []

  // Playtest history: one entry per playtest run, tagged with the spec version and the build it tested.
  for (const i of issues) {
    const specV = i.approvals.spec?.v ?? i.specVersions.length
    for (const b of i.builds) b.specV = specV
    // Re-run seeded playtests now that tags are set, so the comp breakdown names the right unit or item.
    if (i.playtest) i.playtest = makePlaytest(i, i.specVersions[specV - 1].spec, i.playtest.matches, i.playtest.runNo)
    i.playtests = i.playtest
      ? [{ ...i.playtest, specV, ts: i.approvals.playtest?.ts ?? new Date().toISOString(), outcome: i.stage === 'verified' ? 'verified' : null, build: i.build, builds: i.builds }]
      : []
  }

  return {
    issues,
    sourceStatus: {
      reddit: { state: 'ok', live: true },
      x: { state: 'ok', live: false },
          },
    ingest: { postsToday: 3412, newSinceOpen: 0 },
    demo: { failNext: false },
  }
}
