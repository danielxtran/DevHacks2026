import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from './config.js';

test('backend reads the shared hosted Vite credentials and requires a server-only DB URL', () => {
  const config = loadConfig({
    SUPABASE_DB_URL: 'postgresql://server:secret@db.example.supabase.co:5432/postgres',
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'public-anon-key',
  });
  assert.equal(config.supabaseUrl, 'https://example.supabase.co');
  assert.equal(config.supabaseAnonKey, 'public-anon-key');
  assert.equal(config.databaseUrl, 'postgresql://server:secret@db.example.supabase.co:5432/postgres');
  assert.throws(() => loadConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'public' }), /SUPABASE_DB_URL/);
});

test('backend refuses to bind beyond loopback', () => {
  assert.throws(() => loadConfig({
    SUPABASE_DB_URL: 'postgresql://server:secret@db.example.supabase.co:5432/postgres',
    VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'public', API_HOST: '0.0.0.0',
  }), /loopback/);
});
