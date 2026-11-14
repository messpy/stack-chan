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

test('ReferenceError during availability lookup retries direct Archive import', () => {
  const module = { startArchive() {} };
  let imports = 0;
  let reports = 0;
  const result = importOptionalArchive(
    {
      has: () => { throw new ReferenceError('registry lookup failed'); },
      importNow: (name) => {
        assert.equal(name, 'lan-archive');
        imports += 1;
        return module;
      },
    },
    () => { reports += 1; },
  );
  assert.equal(result, module);
  assert.equal(imports, 1);
  assert.equal(reports, 0);
});

test('failed direct import after registry ReferenceError is reported without aborting', () => {
  const failure = new ReferenceError('Archive module evaluation failed');
  let observed;
  const result = importOptionalArchive(
    {
      has: () => { throw new ReferenceError('registry lookup failed'); },
      importNow: () => { throw failure; },
    },
    (error) => { observed = error; },
  );
  assert.equal(result, undefined);
  assert.equal(observed, failure);
});

test('diagnostic reporter failure during fallback import is non-fatal', () => {
  const result = importOptionalArchive(
    {
      has: () => { throw new ReferenceError('registry unavailable'); },
      importNow: () => { throw new ReferenceError('Archive module unavailable'); },
    },
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

test('non-ReferenceError registry failure also permits direct Archive import', () => {
  const module = { startArchive() {} };
  let imports = 0;
  const result = importOptionalArchive({
    has: () => { throw new Error('module registry unavailable'); },
    importNow: () => { imports += 1; return module; },
  }, () => assert.fail('unexpected import failure'));
  assert.equal(result, module);
  assert.equal(imports, 1);
});

test('registry and import failures cannot abort official core startup', () => {
  const failure = new TypeError('registry unavailable');
  let observed;
  const result = importOptionalArchive({
    has: () => { throw new Error('registry unavailable'); },
    importNow: () => { throw failure; },
  }, (error) => { observed = error; });
  assert.equal(result, undefined);
  assert.equal(observed, failure);
});
