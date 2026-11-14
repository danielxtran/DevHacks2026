import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { createDb } from './db';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load env files if present. Values already in the environment win, and the first file to set a variable wins.
// The repository-root .env is the shared file both Vite apps use (vite.config.ts has envDir: '..').
for (const file of ['.env.local', '.env', '../.env.local', '../.env']) {
  try {
    process.loadEnvFile(path.join(appDir, file));
  } catch {
    // missing file: fine
  }
}

// Server-side names first. The VITE_ names are accepted as a fallback because it's the same public anon key.
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY (or the VITE_ equivalents). See .env.example.');
  process.exit(1);
}
if (/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(key) && /service_role/.test(Buffer.from(key.split('.')[1], 'base64url').toString())) {
  console.error('Refusing to start: SUPABASE_ANON_KEY is a service_role key. Use the public anon/publishable key.');
  process.exit(1);
}
if (key.startsWith('sb_secret_')) {
  console.error('Refusing to start: SUPABASE_ANON_KEY is a secret key. Use the public anon/publishable key.');
  process.exit(1);
}

const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 4175;
const host = process.env.HOST || (prod ? '0.0.0.0' : '127.0.0.1');
const trust = process.env.TRUST_PROXY;

const app = createApp({
  db: createDb(url, key),
  staticDir: prod ? path.join(appDir, 'dist') : undefined,
  trustProxy: trust === undefined ? 'loopback' : /^\d+$/.test(trust) ? Number(trust) : trust === 'true' ? true : trust,
});

app.listen(port, host, () => {
  console.log(`R API listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (public, no auth)${prod ? ', serving dist/ too' : ''}`);
});
