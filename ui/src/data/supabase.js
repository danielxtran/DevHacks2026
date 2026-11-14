// Browser Supabase client (publishable/anon key) + read helpers for the UI.
//
// Issues come from the existing `issues` table; the UI-only display state comes
// from the companion `ui_issue_meta` table. We reassemble both into the exact
// issue shape the reducer/components already expect, so the rest of the UI is
// unchanged.

import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseEnabled = Boolean(URL && ANON)
export const supabase = supabaseEnabled ? createClient(URL, ANON, { auth: { persistSession: false } }) : null

// Reassemble a UI issue from an `issues` row joined with its `ui_issue_meta`.
function toIssue(issueRow, meta) {
  const m = meta ?? {}
  return {
    id: issueRow.id,
    game: m.game ?? null,
    title: m.title ?? issueRow.target ?? issueRow.id,
    summary: m.summary ?? '',
    stage: m.stage ?? 'feedback',
    status: m.status ?? 'queued',
    mentions: m.mentions ?? issueRow.weighted_score ?? 0,
    firstSeen: m.first_seen ?? issueRow.created_at ?? null,
    lastMention: m.last_mention ?? null,
    trend: m.trend ?? [],
    sources: m.sources_detail ?? {},
    stat: m.stat ?? null,
    change: m.change ?? null,
    evidence: issueRow.evidence ?? [],
    tags: m.tags ?? [],
    devs: m.devs ?? [],
    comments: m.comments ?? [],
    audit: m.audit ?? [],
    specVersions: m.spec_versions ?? [],
    chat: m.chat ?? [],
    build: m.build ?? null,
    builds: m.builds ?? [],
    playtest: m.playtest ?? null,
    playtests: m.playtests ?? [],
    approvals: m.approvals ?? {},
    run: m.run ?? null,
    error: m.error ?? null,
    dismissed: m.dismissed ?? false,
    rejection: m.rejection ?? null,
    mergedInto: m.merged_into ?? null,
    mergedFrom: m.merged_from ?? [],
  }
}

// Load the full pipeline state (issues + source status + ingest) from Supabase.
export async function loadStateFromSupabase() {
  const [issuesRes, metaRes, srcRes, ingRes] = await Promise.all([
    supabase.from('issues').select('*'),
    supabase.from('ui_issue_meta').select('*'),
    supabase.from('ui_source_status').select('*'),
    supabase.from('ui_ingest').select('*').limit(1).maybeSingle(),
  ])
  for (const res of [issuesRes, metaRes, srcRes, ingRes]) {
    if (res.error) throw res.error
  }

  const metaById = new Map((metaRes.data ?? []).map((m) => [m.issue_id, m]))
  const issues = (issuesRes.data ?? []).map((row) => toIssue(row, metaById.get(row.id)))

  const sourceStatus = {}
  for (const s of srcRes.data ?? []) {
    sourceStatus[s.source] = { state: s.state, live: s.live, message: s.message ?? null }
  }

  const ing = ingRes.data ?? {}
  return {
    issues,
    sourceStatus,
    ingest: { postsToday: ing.posts_today ?? 0, newSinceOpen: ing.new_since_open ?? 0 },
    demo: { failNext: false },
  }
}
