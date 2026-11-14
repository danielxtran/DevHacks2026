// Verify the browser (anon key) can read everything the UI needs.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '../.env.local'), 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })

const issues = await sb.from('issues').select('id,target,target_type,claim,verdict,weighted_score')
const meta = await sb.from('ui_issue_meta').select('issue_id,title,stage,status,mentions')
const src = await sb.from('ui_source_status').select('*')
const ing = await sb.from('ui_ingest').select('*')

console.log('ANON reads:')
console.log('  issues          :', issues.error ? 'ERR ' + issues.error.message : issues.data.length + ' rows')
console.log('  ui_issue_meta   :', meta.error ? 'ERR ' + meta.error.message : meta.data.length + ' rows')
console.log('  ui_source_status:', src.error ? 'ERR ' + src.error.message : src.data.length + ' rows')
console.log('  ui_ingest       :', ing.error ? 'ERR ' + ing.error.message : JSON.stringify(ing.data))
if (!issues.error) console.log('\nsample issue:', JSON.stringify(issues.data.find((x) => x.id === 'iss-101')))
if (!meta.error) console.log('sample meta :', JSON.stringify(meta.data.find((m) => m.issue_id === 'iss-101')))
