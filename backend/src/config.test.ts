import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from './config.js';

const database = 'postgresql://server:secret@db.example.supabase.co:5432/postgres';

test('source HTTP defaults need no Supabase URL or anon key', () => {
  const config = loadConfig({ SUPABASE_DB_URL: database, OPENAI_API_KEY: 'test-openai-key', OPENAI_MODEL: 'test-model' });
  assert.equal(config.riotditBaseUrl, 'http://127.0.0.1:5174');
  assert.equal(config.rBaseUrl, 'http://127.0.0.1:5175');
  assert.equal(config.openaiApiKey, 'test-openai-key');
  assert.equal(config.openaiModel, 'test-model');
  assert.equal(config.databaseUrl, database);
});

test('source HTTP base URLs can be overridden and validated', () => {
  const config = loadConfig({
    SUPABASE_DB_URL: database,
    RIOTDIT_BASE_URL: 'https://reddit.example.test',
    R_BASE_URL: 'http://r.example.test:9000',
  });
  assert.equal(config.riotditBaseUrl, 'https://reddit.example.test');
  assert.equal(config.rBaseUrl, 'http://r.example.test:9000');
  for (const url of ['not a URL', 'ftp://example.test', 'http://user:pass@example.test']) {
    assert.throws(() => loadConfig({ SUPABASE_DB_URL: database, RIOTDIT_BASE_URL: url }), /RIOTDIT_BASE_URL/);
  }
  assert.throws(() => loadConfig({ SUPABASE_DB_URL: database, R_BASE_URL: 'https://user:pass@example.test' }), /R_BASE_URL/);
});

test('backend still requires a server-only DB URL and loopback binding', () => {
  assert.throws(() => loadConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'public' }), /SUPABASE_DB_URL/);
  assert.throws(() => loadConfig({ SUPABASE_DB_URL: database, API_HOST: '0.0.0.0' }), /loopback/);
});
