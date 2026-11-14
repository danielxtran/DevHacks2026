// One-time data push: generate the UI seed and write it to Supabase.
//
//   node supabase/push-seed.mjs
//
// Uses the SERVICE ROLE / secret key from .env.local (bypasses RLS). Issues go
// into the existing `issues` table (mapped onto its real columns, anchored to a
// single `runs` row). Everything the UI needs that `issues` can't hold goes into
// the companion `ui_issue_meta` table, plus `ui_source_status` and `ui_ingest`.
//
// Idempotent: upserts on primary keys, and reuses an existing 'ui-seed' run.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { makeSeed } from '../src/data/seed.js'
import { tagInfo } from '../src/data/constants.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---- load env ----
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '../.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const URL = env.VITE_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'); process.exit(1) }

const sb = createClient(URL, KEY, { auth: { persistSession: false } })

// ---- mapping helpers (UI issue -> existing `issues` columns) ----
function targetOf(issue) {
  // first specific tag (unit/item/trait/etc.), else change.context id, else slug of title
  const specific = (issue.tags ?? []).map(tagInfo).find((t) => t && t.family === 'specific')
  if (specific) return specific.label
  const ctx = issue.change?.context
  return ctx?.id || ctx?.weapon || ctx?.region || ctx?.skin || issue.id
}
// The existing `issues.target_type` CHECK only allows 'unit' | 'trait'.
// Map every UI target onto the nearest of the two (items/systems/bugs -> unit,
// since there is no column for them). The real tag detail is preserved in
// ui_issue_meta.tags, so nothing is lost in the UI.
function targetTypeOf(issue) {
  const infos = (issue.tags ?? []).map(tagInfo).filter(Boolean)
  const specific = infos.find((t) => t.family === 'specific')
  if (specific?.target === 'trait') return 'trait'
  if (specific?.target === 'unit') return 'unit'
  const fix = infos.find((t) => t.family === 'fix')
  if (fix?.target === 'trait') return 'trait'
  return 'unit'
}
// claim_type enum: too_strong | too_weak | feels_bad | bug | other
function claimOf(issue) {
  const tags = (issue.tags ?? []).map(tagInfo).filter(Boolean)
  if (tags.some((t) => t.target === 'bug')) return 'bug'
  if (tags.some((t) => t.dir === 'nerf')) return 'too_strong'
  if (tags.some((t) => t.dir === 'buff')) return 'too_weak'
  // complaint not backed by live data -> perception problem
  const m = issue.change?.metric
  if (m && issue.stat && issue.stat.value >= m.target?.[0] && issue.stat.value <= m.target?.[1]) return 'feels_bad'
  return 'other'
}
// verdict_type enum: supported | not_supported | inconclusive | out_of_scope
function verdictOf(issue) {
  const o = issue.playtest?.overall
  if (!o) return null
  if (o === 'supported') return 'supported'
  if (o === 'not_supported') return 'not_supported'
  if (o === 'inconclusive') return 'inconclusive'
  if (o === 'partial' || o === 'failed') return 'inconclusive'
  return null
}

async function main() {
  const seed = makeSeed()

  // 1) anchor run (reuse if present)
  let runId
  const { data: existing, error: findErr } = await sb.from('runs').select('id').eq('fixture_set', 'ui-seed').limit(1)
  if (findErr) throw findErr
  if (existing?.length) {
    runId = existing[0].id
    console.log('reusing run', runId)
  } else {
    const { data, error } = await sb.from('runs').insert({ mode: 'ours', status: 'done', fixture_set: 'ui-seed' }).select('id').single()
    if (error) throw error
    runId = data.id
    console.log('created run', runId)
  }

  // 2) issues (existing table) + companion meta
  const issueRows = []
  const metaRows = []
  for (const i of seed.issues) {
    issueRows.push({
      run_id: runId,
      id: i.id,
      target: targetOf(i),
      target_type: targetTypeOf(i),
      claim: claimOf(i),
      post_ids: (i.evidence ?? []).map((e) => e.id),
      post_count: Object.values(i.sources ?? {}).reduce((a, b) => a + b, 0),
      weighted_score: i.mentions ?? 0,
      sources: Object.keys(i.sources ?? {}),
      quotes: (i.evidence ?? []).map((e) => e.text),
      verdict: verdictOf(i),
      evidence: i.evidence ?? [],
    })
    metaRows.push({
      issue_id: i.id,
      run_id: runId,
      title: i.title,
      summary: i.summary,
      game: i.game,
      stage: i.stage,
      status: i.status,
      mentions: i.mentions ?? 0,
      first_seen: i.firstSeen,
      last_mention: i.lastMention,
      trend: i.trend ?? [],
      sources_detail: i.sources ?? {},
      stat: i.stat ?? null,
      change: i.change ?? null,
      tags: i.tags ?? [],
      devs: i.devs ?? [],
      comments: i.comments ?? [],
      audit: i.audit ?? [],
      spec_versions: i.specVersions ?? [],
      chat: i.chat ?? [],
      build: i.build ?? null,
      builds: i.builds ?? [],
      playtest: i.playtest ?? null,
      playtests: i.playtests ?? [],
      approvals: i.approvals ?? {},
      run: i.run ?? null,
      error: i.error ?? null,
      dismissed: !!i.dismissed,
      rejection: i.rejection ?? null,
      merged_into: i.mergedInto ?? null,
      merged_from: i.mergedFrom ?? [],
    })
  }

  let r = await sb.from('issues').upsert(issueRows, { onConflict: 'run_id,id' })
  if (r.error) throw r.error
  console.log(`upserted ${issueRows.length} issues`)

  r = await sb.from('ui_issue_meta').upsert(metaRows, { onConflict: 'issue_id' })
  if (r.error) throw r.error
  console.log(`upserted ${metaRows.length} ui_issue_meta`)

  // 3) source status
  const srcRows = Object.entries(seed.sourceStatus).map(([source, s]) => ({
    source, state: s.state, live: !!s.live, message: s.message ?? null,
  }))
  r = await sb.from('ui_source_status').upsert(srcRows, { onConflict: 'source' })
  if (r.error) throw r.error
  console.log(`upserted ${srcRows.length} ui_source_status`)

  // 4) ingest (singleton)
  r = await sb.from('ui_ingest').upsert({ id: 1, posts_today: seed.ingest.postsToday, new_since_open: seed.ingest.newSinceOpen }, { onConflict: 'id' })
  if (r.error) throw r.error
  console.log('upserted ui_ingest')

  console.log('\nDone.')
}

main().catch((e) => { console.error('PUSH FAILED:', e.message || e); process.exit(1) })
