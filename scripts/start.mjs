#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const children = [];
let stopping = false;

function signalChildren(signal) {
  for (const child of children) {
    if (!child.pid) continue;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(`Could not stop process group ${child.pid}: ${error.message}`);
    }
  }
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping apps…');
  signalChildren('SIGTERM');
  setTimeout(() => {
    signalChildren('SIGKILL');
    process.exit(code);
  }, 3000);
}

async function envFile(path) {
  try {
    return parseEnv(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => reject(new Error(`Port ${port} is unavailable (${error.code}). Stop the existing app first.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Use Node.js 22.12 or newer.');
  // shortcut: POSIX process groups supervise npm descendants; use a Windows supervisor if Windows support is needed.
  if (process.platform === 'win32') throw new Error('Run this launcher on Linux, macOS, or WSL.');

  const env = { ...await envFile(join(root, '.env')), ...await envFile(join(root, 'backend', '.env')), ...process.env };
  const backendPort = Number(env.API_PORT || 3001);
  if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) throw new Error('API_PORT must be an integer from 1 to 65535.');
  const hexlabUrl = new URL(env.HEXLAB_API_URL || 'http://127.0.0.1:3002/api');
  if (hexlabUrl.protocol !== 'http:' || !['127.0.0.1', '::1', 'localhost'].includes(hexlabUrl.hostname) || hexlabUrl.username || hexlabUrl.password) {
    throw new Error('HEXLAB_API_URL must be an unauthenticated HTTP URL on loopback.');
  }
  const hexlabPort = Number(hexlabUrl.port || 3002);
  if (!Number.isInteger(hexlabPort) || hexlabPort < 1 || hexlabPort > 65535) throw new Error('HEXLAB_API_URL must use a valid local port.');
  const apps = [
    { name: 'backend', port: backendPort, bin: 'tsx', args: [] },
    { name: 'ui', port: 5173, bin: 'vite', args: ['--', '--host', '127.0.0.1'] },
    { name: 'mockreddit', port: 5174, bin: 'vite', args: ['--', '--host', '127.0.0.1'] },
    { name: 'mockr', port: 5175, bin: 'vite', args: ['--', '--host', '127.0.0.1'] },
    { name: 'hexlab', dir: 'tft-clone', port: hexlabPort, extraPorts: [5176], bin: 'concurrently', script: 'dev:local', env: { PORT: String(hexlabPort) } },
  ];
  const ports = apps.flatMap(({ port, extraPorts = [] }) => [port, ...extraPorts]);
  if (new Set(ports).size !== ports.length) throw new Error('Configured application ports conflict.');

  for (const app of apps) {
    const dir = app.dir ?? app.name;
    try {
      await access(join(root, dir, 'node_modules', '.bin', app.bin));
    } catch {
      throw new Error(`Missing ${app.name} dependencies. Run: npm --prefix ${dir} ci`);
    }
  }
  for (const port of ports) await checkPort(port);

  process.once('SIGINT', () => stop(130));
  process.once('SIGTERM', () => stop(143));
  console.log('Starting apps (service output below; URLs do not imply readiness):');
  console.log('The backend polls hosted sources and may make billable model calls when configured.');
  for (const app of apps) {
    const dir = app.dir ?? app.name;
    const appPorts = [app.port, ...(app.extraPorts ?? [])];
    console.log(`  ${app.name.padEnd(11)} ${appPorts.map(port => `http://127.0.0.1:${port}`).join(' · ')}`);
    const child = spawn('npm', ['run', app.script ?? 'dev', ...(app.args ?? [])], {
      cwd: join(root, dir),
      // Each app loads its own env files; never pass parsed backend secrets to Vite.
      env: { ...process.env, ...(app.env ?? {}), API_HOST: '127.0.0.1', NO_OPEN: '1' },
      stdio: 'inherit',
      detached: true,
    });
    children.push(child);
    child.once('error', (error) => {
      console.error(`${app.name} could not start: ${error.message}`);
      stop(1);
    });
    child.once('exit', (code, signal) => {
      if (stopping) return;
      console.error(`${app.name} exited (${signal ?? code}); stopping the other apps.`);
      stop(code || 1);
    });
  }
}

main().catch((error) => {
  console.error(error.message);
  if (children.length) stop(1);
  else process.exitCode = 1;
});
