import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function loadApp(filename, context, names) {
  const url = new URL('../../host/app/' + filename, import.meta.url);
  const source = readFileSync(url, 'utf8')
    .replace(/^import .+;\s*$/gm, '')
    .replace(/^export /gm, '');
  vm.runInContext(source + '\n;globalThis.subject={' + names.join(',') + '};', context, { filename });
  return context.subject;
}

function fakeTimer() {
  let serial = 0;
  const pending = new Map();
  return {
    pending,
    timer: {
      set(callback, delay) {
        const id = ++serial;
        pending.set(id, { callback, delay });
        return id;
      },
      clear(id) {
        pending.delete(id);
      },
    },
  };
}

test('abandoned image upload expires without another incoming request', () => {
  const { timer, pending } = fakeTimer();
  const context = vm.createContext({ Timer: timer });
  const { imageUploadCommand } = loadApp('archive-image-upload.js', context, ['imageUploadCommand']);
  const first = imageUploadCommand('begin', { size: 1024 });
  assert.equal(pending.size, 1);
  const expiry = [...pending.values()][0];
  assert.equal(expiry.delay, 120000);
  expiry.callback();
  const second = imageUploadCommand('begin', { size: 1024 });
  assert.ok(second.id);
  assert.equal(pending.size, 1);
  imageUploadCommand('cancel', { id: second.id });
  assert.equal(pending.size, 0);
  assert.ok(first.id);
});

test('vision HTTP does not resolve until the response completion callback', async () => {
  const { timer } = fakeTimer();
  let callbacks;
  class FakeHTTPClient {
    request(options) { callbacks = options; }
    close() {}
  }
  const context = vm.createContext({
    Timer: timer,
    trace() {},
    TextDecoder,
    device: { network: { https: { client: { io: FakeHTTPClient, socket: { tls: {} } } } } },
  });
  vm.runInContext('String.fromArrayBuffer = bytes => new TextDecoder().decode(new Uint8Array(bytes));', context);
  const { postVision } = loadApp('archive-vision-http.js', context, ['postVision']);
  const response = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  const bytes = new TextEncoder().encode(response);
  const promise = postVision('generativelanguage.googleapis.com', '/test', [], new Uint8Array([1]).buffer);
  let settled = false;
  promise.then(() => { settled = true; });
  callbacks.onHeaders(200);
  callbacks.onReadable.call({ read: () => bytes.buffer }, bytes.byteLength);
  await Promise.resolve();
  assert.equal(settled, false);
  callbacks.onDone();
  assert.equal(await promise, response);
});

test('corrupted vault blocks changes without overwriting either backup slot', () => {
  let writeAttempts = 0;
  const root = {
    createDirectory() {},
    openFile({ path, mode }) {
      if (mode !== 'r') { writeAttempts++; throw new Error('unexpected write'); }
      if (!path.endsWith('settings-0.bin')) throw new Error('not found');
      return {
        status() { return { size: 40 }; },
        read() { return new ArrayBuffer(40); },
        close() {},
      };
    },
  };
  const context = vm.createContext({
    withSDCard(callback) { return callback(root); },
    openVault() { throw new Error('authentication failed'); },
    sealVault() { throw new Error('should not seal'); },
    randomBytes() { return new Uint8Array(16); },
    trace() {},
  });
  const { changeSettings, vaultStatus } = loadApp('archive-vault.js', context, ['changeSettings', 'vaultStatus']);
  assert.throws(() => changeSettings(settings => { settings.chatMode = true; }), /上書きを中止/);
  assert.equal(vaultStatus().loadError, true);
  assert.equal(writeAttempts, 0);
});
