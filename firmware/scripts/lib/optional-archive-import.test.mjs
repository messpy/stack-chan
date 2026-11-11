import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Import the exact device helper source without loading embedded runtime modules.
const source = readFileSync(new URL('../../host/app/optional-archive-import.js', import.meta.url), 'utf8');
const { importOptionalArchive } = await import('data:text/javascript,' + encodeURIComponent(source));

test('missing Archive module preserves core startup', () => {
  let called = false;
  const result = importOptionalArchive(
    { has: () => false, importNow: () => { called = true; throw new Error('must not import'); } },
    () => { called = true; },
  );
  assert.equal(result, undefined);
  assert.equal(called, false);
});

test('working Archive module is returned unchanged', () => {
  const module = { startArchive() {} };
  let imported = 0;
  const result = importOptionalArchive({
    has: (name) => name === 'lan-archive',
    importNow: (name) => {
      assert.equal(name, 'lan-archive');
      imported += 1;
      return module;
    },
  }, () => assert.fail('unexpected failure'));
  assert.equal(result, module);
  assert.equal(imported, 1);
});

test('ReferenceError during import is reported and does not abort core boot', () => {
  const failure = new ReferenceError('private error details must not be serialized');
  let observed;
  const result = importOptionalArchive(
    { has: () => true, importNow: () => { throw failure; } },
    (error) => { observed = error; },
  );
  assert.equal(result, undefined);
  assert.equal(observed, failure);
});

test('ReferenceError during Archive availability lookup is reported without aborting core boot', () => {
  const failure = new ReferenceError('Archive registry lookup failed');
  let observed;
  let imported = false;
  const result = importOptionalArchive(
    { has: () => { throw failure; }, importNow: () => { imported = true; } },
    (error) => { observed = error; },
  );
  assert.equal(result, undefined);
  assert.equal(observed, failure);
  assert.equal(imported, false);
});

test('diagnostic reporter failure during availability lookup is non-fatal', () => {
  const result = importOptionalArchive(
    { has: () => { throw new ReferenceError('Archive unavailable'); } },
    () => { throw new Error('USB diagnostics unavailable'); },
  );
  assert.equal(result, undefined);
});

test('reporter failure cannot replace a failed import', () => {
  const result = importOptionalArchive(
    { has: () => true, importNow: () => { throw new ReferenceError('archive'); } },
    () => { throw new Error('diagnostic channel unavailable'); },
  );
  assert.equal(result, undefined);
});

test('errors after successful import remain visible to startup error handling', () => {
  const module = { startArchive: () => { throw new Error('partial Archive initialization'); } };
  const result = importOptionalArchive(
    { has: () => true, importNow: () => module },
    () => assert.fail('unexpected callback'),
  );
  assert.throws(() => result.startArchive(), /partial Archive initialization/);
});

test('registry availability errors are not silently swallowed', () => {
  assert.throws(
    () => importOptionalArchive({ has: () => { throw new Error('module registry unavailable'); } }),
    /module registry unavailable/,
  );
});
