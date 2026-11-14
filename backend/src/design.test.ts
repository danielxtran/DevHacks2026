import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { materializeChecks, validateCheckPath } from './design.js';

test('generated check paths are relative, confined, and executable-source files', () => {
  assert.equal(validateCheckPath('checks/stun.test.ts'), 'checks/stun.test.ts');
  for (const unsafe of ['/tmp/check.ts', '../check.ts', 'checks/../../secret.ts', 'checks/.env', 'checks/data.txt']) {
    assert.throws(() => validateCheckPath(unsafe));
  }
});

test('checks materialize inside the candidate workspace without overwriting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-checks-'));
  try {
    const paths = await materializeChecks(root, [{ path: 'checks/stun.test.ts', contents: 'assert.equal(1, 1);' }]);
    assert.deepEqual(paths, ['checks/stun.test.ts']);
    assert.equal(await readFile(join(root, paths[0]!), 'utf8'), 'assert.equal(1, 1);');
    await assert.rejects(materializeChecks(root, [{ path: paths[0]!, contents: 'changed' }]));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('checks cannot escape through a workspace symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-checks-'));
  const outside = await mkdtemp(join(tmpdir(), 'design-outside-'));
  try {
    await symlink(outside, join(root, 'checks'));
    await assert.rejects(materializeChecks(root, [{ path: 'checks/escape.ts', contents: 'bad' }]));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
