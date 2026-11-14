export function timeAgo(iso, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function duration(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

export const num = (n) => n.toLocaleString()

export function stamp(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Rising-fastest score for "trending" sort: last 3 days vs. previous 3.
export function trendScore(trend) {
  const recent = trend.slice(-3).reduce((a, b) => a + b, 0)
  const prior = trend.slice(-6, -3).reduce((a, b) => a + b, 0) || 1
  return recent / prior
}
