import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('./start.mjs', import.meta.url));
const frontends = [5173, 5174, 5175];

async function fixture(dependencies = true) {
  const root = await mkdtemp(join(tmpdir(), 'devhacks-start-'));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'bin'));
  await copyFile(launcher, join(root, 'scripts/start.mjs'));
  if (dependencies) {
    for (const app of ['backend', 'ui', 'mockreddit', 'mockr']) {
      await mkdir(join(root, app, 'node_modules/.bin'), { recursive: true });
      await writeFile(join(root, app, 'node_modules/.bin', app === 'backend' ? 'tsx' : 'vite'), 'fixture');
    }
  }
  await writeFile(join(root, 'bin/npm'), `#!/usr/bin/env node
const {spawn}=require('node:child_process');
const {basename}=require('node:path');
const app=basename(process.cwd());
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
console.log('STARTED',app,process.pid,child.pid,'secret='+Boolean(process.env.SERVER_ONLY_TOKEN));
process.on('SIGTERM',()=>{child.kill();child.once('exit',()=>process.exit(0));});
if(process.env.FAIL_APP===app)setTimeout(()=>{child.kill();child.once('exit',()=>process.exit(42));},300);
setInterval(()=>{},1000);
`, { mode: 0o700 });
  return root;
}

function launch(root, env = {}) {
  const child = spawn(process.execPath, [join(root, 'scripts/start.mjs')], {
    cwd: tmpdir(),
    env: { PATH: `${join(root, 'bin')}:${process.env.PATH}`, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  const timer = setTimeout(() => child.kill('SIGTERM'), 8000);
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output });
    });
  });
  return { child, done, output: () => output };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function frontendPortsAvailable() {
  for (const port of frontends) {
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
    } catch (error) {
      if (error.code === 'EADDRINUSE') return false;
      throw error;
    } finally {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
  }
  return true;
}

async function waitForApps(run) {
  const deadline = Date.now() + 5000;
  while ((run.output().match(/STARTED /g) ?? []).length < 4) {
    if (Date.now() > deadline) throw new Error(`Apps did not start: ${run.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function assertStopped(output) {
  for (const match of output.matchAll(/STARTED \w+ (\d+) (\d+)/g)) {
    for (const pid of match.slice(1).map(Number)) {
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    }
  }
}

test('missing dependencies fail before any app starts', async () => {
  const root = await fixture(false);
  try {
    const result = await launch(root).done;
    assert.equal(result.code, 1);
    assert.match(result.output, /npm --prefix backend ci/);
    assert.doesNotMatch(result.output, /STARTED /);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a conflicting configured backend port fails before startup', async () => {
  const root = await fixture();
  try {
    const result = await launch(root, { API_PORT: '5173' }).done;
    assert.equal(result.code, 1);
    assert.match(result.output, /API_PORT conflicts/);
    assert.doesNotMatch(result.output, /STARTED /);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an occupied port is reported without stopping its owner', async () => {
  const root = await fixture();
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await launch(root, { API_PORT: String(server.address().port) }).done;
    assert.equal(result.code, 1);
    assert.match(result.output, /Port .* unavailable/);
    assert.doesNotMatch(result.output, /STARTED /);
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('starts all apps from another cwd and Ctrl+C stops their descendants', async (t) => {
  if (!await frontendPortsAvailable()) return t.skip('a frontend port is already occupied');
  const root = await fixture();
  await mkdir(join(root, 'backend'), { recursive: true });
  await writeFile(join(root, 'backend/.env'), `API_PORT=${await freePort()}\nSERVER_ONLY_TOKEN=fixture-secret\n`);
  const run = launch(root);
  try {
    await waitForApps(run);
    run.child.kill('SIGINT');
    const result = await run.done;
    assert.equal(result.code, 130);
    for (const app of ['backend', 'ui', 'mockreddit', 'mockr']) assert.match(result.output, new RegExp(`STARTED ${app} `));
    assert.doesNotMatch(result.output, /secret=true/);
    assertStopped(result.output);
  } finally {
    if (run.child.exitCode === null) { run.child.kill('SIGTERM'); await run.done; }
    await rm(root, { recursive: true, force: true });
  }
});

test('an app failure stops siblings and preserves its exit status', async (t) => {
  if (!await frontendPortsAvailable()) return t.skip('a frontend port is already occupied');
  const root = await fixture();
  const run = launch(root, { API_PORT: String(await freePort()), FAIL_APP: 'backend' });
  try {
    const result = await run.done;
    assert.equal(result.code, 42);
    assert.match(result.output, /backend exited \(42\)/);
    assertStopped(result.output);
  } finally {
    if (run.child.exitCode === null) { run.child.kill('SIGTERM'); await run.done; }
    await rm(root, { recursive: true, force: true });
  }
});
