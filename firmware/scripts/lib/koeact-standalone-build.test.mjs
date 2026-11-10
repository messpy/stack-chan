import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const script = fileURLToPath(new URL('../koeact-standalone-build.sh', import.meta.url));
test('Bash syntax and no-flash help', () => {
  execFileSync('bash', ['-n', script]);
  const help = execFileSync('bash', [script, '--help'], { encoding: 'utf8' });
  assert.match(help, /This script NEVER flashes/);
  assert.match(help, /check\|fetch\|verify\|build/);
});
test('check mode must not create a model directory', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'koeact-check-'));
  try {
    const run = spawnSync('bash', [script, 'check'], { encoding: 'utf8', env: { ...process.env, KOEACT_MODEL_DIR: path.join(root, 'none') } });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Missing: SHA256SUMS/);
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('verify and build fail without official signed hash manifest', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'koeact-verify-'));
  try {
    for (const mode of ['verify', 'build']) {
      const run = spawnSync('bash', [script, mode], { encoding: 'utf8', env: { ...process.env, KOEACT_MODEL_DIR: path.join(root, 'missing') } });
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /SHA256SUMS/);
    }
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('unknown operation and relative paths are blocked', () => {
  assert.notEqual(spawnSync('bash', [script, 'flash'], { encoding: 'utf8' }).status, 0);
  const run = spawnSync('bash', [script, 'check'], { encoding: 'utf8', env: { ...process.env, KOEACT_MODEL_DIR: 'relative/path' } });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /絶対パス/);
});
