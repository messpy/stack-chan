import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

// Exercise the real adapter, queue and XiaoZhi model. Only the platform I/O,
// codecs and scheduler are simulated. With MODDABLE, also use its real base.
const app = new URL('../../host/app/', import.meta.url)
const modelPath = new URL('../../host/modules/conversation/chat-audioio/xiaozhi-model.js', import.meta.url)

async function harness() {
  let now = 1000
  const deferred = [], repeats = [], writes = [], completions = [], events = [], messages = [], subtitles = [], traceLines = []
  const timer = { repeat(fn) { repeats.push(fn); return repeats.length }, clear() {}, set(fn) { deferred.push(fn); return deferred.length } }
  class Input { start() { events.push('mic-open') } close() { events.push('mic-close') } }
  class Output {
    static Async = class {
      write(bytes, done) { writes.push(Uint8Array.from(bytes)); completions.push(done) }
      start() { events.push('output-start') }
      close() { events.push('output-close') }
    }
  }
  class Base {
    static DISCONNECTED = 0; static SPEAKING = 4; static LISTENING = 5; static WAITING = 6
    listen() { if (this.state === Base.SPEAKING) { this.state = Base.LISTENING; this.ensureOutput(); this.onStateChanged(this.state) } }
    speak() { this.state = Base.WAITING }
    receiveAudio(m) { this.outputBufferHead = m.offset + m.size }
    receiveOutputText(m) { this.onOutputTranscript(m.text, m.more) }
  }
  const context = vm.createContext({ SharedArrayBuffer, Uint8Array, Int16Array, Int32Array, Atomics,
    Date: { now: () => now }, trace(...parts) { traceLines.push(parts.join('')) }, URL })
  const dependencies = { timer: { default: timer }, worker: { default: class {} },
    'embedded:io/audio/in': { default: Input }, 'embedded:io/audio/out': { default: Output },
    archivePcmRingWriter: { writePcmRing() {} }, stackchanPcmRingWriter: { writePcmRing() {} } }
  const cache = new Map()
  async function load(name, source) {
    if (cache.has(name)) return cache.get(name)
    const module = source === undefined
      ? new vm.SyntheticModule(Object.keys(dependencies[name]), function () {
          for (const [key, value] of Object.entries(dependencies[name])) this.setExport(key, value)
        }, { context })
      : new vm.SourceTextModule(source, { context, identifier: name })
    cache.set(name, module)
    await module.link(specifier => load(specifier))
    await module.evaluate()
    return module
  }
  const sdk = process.env.MODDABLE && `${process.env.MODDABLE}/modules/network/services/chatAudioIO/ChatAudioIO.js`
  dependencies.ChatAudioIO = { default: Base }
  if (sdk) await load('ChatAudioIO', fs.readFileSync(sdk, 'utf8'))
  await load('archive-playback-buffer', fs.readFileSync(new URL('archive-playback-buffer.js', app), 'utf8'))
  const adapter = await load('adapter', fs.readFileSync(process.env.STACKCHAN_AUDIO_ADAPTER_UNDER_TEST || new URL('archive-chat-audioio.js', app), 'utf8'))
  const io = Object.create(adapter.namespace.default.prototype)
  Object.assign(io, { state: 4, output: null, input: new Input(), inputSampleRate: 16000,
    outputSampleRate: 24000, playbackPrebufferMs: 0, volume: 0.4,
    outputBuffer: new SharedArrayBuffer(65536), outputBufferHead: 0, outputBufferTail: 0,
    barrier: new Int32Array(new SharedArrayBuffer(4)), onStateChanged() {},
    onOutputLevelChanged() {}, onInputTranscript() {}, onOutputTranscript(text) { if (text) subtitles.push(text) },
    worker: { postMessage(message) { messages.push(message) } } })
  class WorkerBase {
    connect() {}
    post(id) { this.postMessage({ id }) }
    postMessage(message) {
      events.push(message.id)
      if (typeof io[message.id] === 'function') io[message.id](message)
    }
    sendJSON() {}
  }
  dependencies.stackchanServerChatWebSocketWorker = { default: WorkerBase }
  dependencies.stackchanOpusDecoder = { default: class {} }
  dependencies.stackchanOpusEncoder = { default: class {} }
  dependencies['xiaozhi-contract'] = { parseJsonRpcMessage: x => x, parseXiaozhiV1ClientEvent: x => x,
    parseXiaozhiV1ServerEvent: x => x, sanitizeXiaozhiV1HelloExtension: x => x }
  const modelModule = await load('model', fs.readFileSync(modelPath, 'utf8'))
  const model = new modelModule.namespace.default({})
  Object.assign(model, { replyRequested: true, replyDeadline: now + 30000, encoder: { clear() {} },
    decoderPCM: new SharedArrayBuffer(8192),
    decoder: { decode(packet, destination) { new Uint8Array(destination).fill(packet[0]); return 8192 }, decodeUs: 1 },
    silence: new ArrayBuffer(4096), parser: {
      copy(bytes) {
        bytes = new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength)
        let used = 0
        while (used < bytes.byteLength) {
          const offset = io.outputBufferHead === io.outputBuffer.byteLength ? 0 : io.outputBufferHead
          const size = Math.min(bytes.byteLength - used, io.outputBuffer.byteLength - offset)
          new Uint8Array(io.outputBuffer, offset, size).set(bytes.subarray(used, used + size))
          io.receiveAudio({ offset, size }); used += size
        }
      }, done() {},
    } })
  function start() { model.tts({ state: 'start' }) }
  function stop() { model.tts({ state: 'stop' }) }
  function pump() { io.pumpPlayback(io.output, io.playback) }
  function completeWrites() { while (completions.length) completions.shift()() }
  function tick(ms = 2000) { now += ms; pump() }
  function runDeferred() { while (deferred.length) deferred.shift()() }
  function pcm(value = 7) { model.read(Uint8Array.of(value), { binary: true }) }
  return { io, model, events, messages, subtitles, writes, deferred, traceLines, start, stop, pcm, pump,
    completeWrites, tick, runDeferred, tickRepeats() { for (const fn of [...repeats]) fn() } }
}

test('subtitles and new PCM continue during previous drain without early microphone restart', async () => {
  const h = await harness()
  h.start(); h.pcm(3); h.pump(); h.completeWrites(); h.stop(); h.pump()
  const original = h.io.output
  h.start(); h.model.tts({ state: 'sentence_start', text: 'second answer' }); h.pcm(9)
  assert.deepEqual(h.subtitles, ['second answer'])
  assert.equal(h.io.state, 5)
  h.pump(); h.completeWrites(); h.tick(); h.runDeferred()
  assert.equal(h.io.output, original)
  assert.equal(h.messages.filter(x => x.id === 'listened').length, 0)
  assert.ok(h.writes.some(bytes => bytes.includes(9)))
  assert.equal(h.io.playback.queue.failures, 0)
  assert.equal(h.io.playback.queue.completedBytes, h.io.playback.queue.submittedBytes)
  h.stop(); h.pump(); h.completeWrites(); h.tick(); h.tick(); h.runDeferred()
  assert.equal(h.messages.filter(x => x.id === 'listened').length, 1)
  assert.equal(h.io.state, 4)
  assert.equal(h.events.filter(x => x === 'mic-open').length, 1)
})

test('queued old completion cannot close output after a new start AND stop', async () => {
  const h = await harness()
  h.start(); h.stop(); h.pump(); h.completeWrites(); h.tick(); h.tick()
  assert.equal(h.deferred.length, 1)
  h.start(); h.pcm(); h.stop()
  h.runDeferred()
  assert.equal(h.io.state, 6)
  assert.equal(h.messages.length, 0)
  h.pump(); h.completeWrites(); h.tick(); h.tick(); h.runDeferred()
  assert.equal(h.messages.length, 1)
})

test('late PCM invalidates a queued completion and is drained before microphone resumes', async () => {
  const h = await harness()
  h.start(); h.stop(); h.pump(); h.completeWrites(); h.tick(); h.tick()
  h.pcm(11); h.runDeferred()
  assert.equal(h.messages.length, 0)
  h.pump(); h.completeWrites(); h.tick(); h.tick(); h.runDeferred()
  assert.equal(h.messages.length, 1)
  assert.ok(h.writes.some(bytes => bytes.includes(11)))
})

test('Worker rejects old drain acknowledgement even if its next TTS already stopped', async () => {
  const h = await harness()
  h.start(); const old = h.model.playbackTurn
  h.start(); h.stop()
  h.model.uploading = false
  h.model.listenStarts = 0
  h.model.startListening = () => { h.model.listenStarts++ }
  h.model.listened({ turn: old })
  assert.equal(h.model.listenStarts, 0)
  h.model.listened({ turn: h.model.playbackTurn })
  assert.equal(h.model.listenStarts, 1)
})

test('Worker does not reopen microphone while current cloud TTS is active', async () => {
  const h = await harness()
  h.start()
  let resumed = 0; h.model.startListening = () => resumed++
  h.model.listened({ turn: h.model.playbackTurn })
  assert.equal(resumed, 0)
  h.model.tts({ state: 'sentence_start', text: 'visible' }); h.pcm()
  assert.deepEqual(h.subtitles, ['visible'])
  assert.equal(h.model.decodePackets, 1)
})

test('old stop and late start after close cannot alter current output ownership', async () => {
  const h = await harness()
  h.start(); const old = h.model.playbackTurn; h.start()
  h.io.speak({ turn: old }); assert.equal(h.io.state, 5)
  h.io.closed = true; h.io.listen({ turn: old }); assert.equal(h.io.state, 5)
})

test('ten complete turns preserve PCM order and resume microphone exactly once per turn', async () => {
  const h = await harness()
  for (let turn = 1; turn <= 10; turn++) {
    h.model.stt({ text: `question ${turn}` })
    h.start(); h.model.tts({ state: 'sentence_start', text: `answer ${turn}` }); h.pcm(turn)
    h.stop(); h.pump()
    assert.equal(h.messages.length, turn - 1, 'native writes have not completed')
    h.completeWrites(); h.tick(); h.tick(); h.runDeferred()
    assert.equal(h.messages.length, turn)
    assert.equal(h.io.output, null)
    assert.equal(h.io.playback, undefined)
  }
  assert.equal(h.subtitles.length, 10)
  assert.equal(h.events.filter(x => x === 'mic-open').length, 10)
  assert.equal(h.events.filter(x => x === 'output-close').length, 10)
  const expected = []
  for (let turn = 1; turn <= 10; turn++) expected.push(...new Uint8Array(8192).fill(turn), ...new Uint8Array(4096))
  assert.deepEqual(h.writes.flatMap(bytes => [...bytes]), expected)
})

test('decode failure is counted separately from discarded downlink fragments', async () => {
  const h = await harness()
  h.start(); h.model.decoder.decode = () => { throw Error('test codec failure') }
  let failure; h.model.fail = value => { failure = value }
  h.pcm(); assert.match(failure, /codec failure/)
  assert.equal(h.model.audioPath.failures, 1)
  assert.equal(h.model.audioPath.decoded, 0)
  h.model.uploading = true; h.pcm()
  assert.equal(h.model.audioPath.skipped, 1)
  assert.equal(h.model.audioPath.fragments, 2)
})

test('native write failure is counted and prevents a successful drain acknowledgement', async () => {
  const h = await harness()
  h.start(); h.pcm(); h.stop(); h.pump()
  const queue = h.io.playback.queue
  // Existing writes remain in flight; fail the next native enqueue.
  h.io.output.write = () => { throw Error('native queue failed') }
  h.pcm(); h.pump()
  assert.equal(h.messages.length, 0)
  assert.equal(queue.failures, 1)
  assert.equal(h.io.output, null)
})

test('a queued completion from a closed session cannot reopen its microphone', async () => {
  const h = await harness()
  h.start(); h.stop(); h.pump(); h.completeWrites(); h.tick(); h.tick()
  const messages = h.messages.length
  h.io.worker.terminate = () => {}
  h.io.close(); h.runDeferred()
  assert.equal(h.messages.length, messages)
  assert.equal(h.events.filter(x => x === 'mic-open').length, 0)
})

test('heartbeat reports microphone upload and decode absence before any TTS starts', async () => {
  const h = await harness()
  h.model.encoder.capturedPcmBytes = 3840
  h.model.encoder.droppedPcmBytes = 0
  h.model.connect({})
  h.tickRepeats()
  const output = h.traceLines.join('')
  assert.match(output, /stage=upload event=heartbeat/)
  assert.match(output, /capturedPcmBytes=3840/)
  assert.match(output, /encodedPackets=0/)
  assert.match(output, /stage=decode/)
  assert.ok(h.events.includes('audioDiagnostics'), 'worker snapshots must be delivered to main VM')
})

test('worker transport events and ASR metadata cross main VM without transcript bodies', async () => {
  const h = await harness()
  h.model.postAudioDiagnostic('[audio-path] stage=transport event=close_frame ms=10 closeCode=1006\\n')
  h.model.stt({ text: 'private recognition text' })
  assert.match(h.traceLines.join(''), /closeCode=1006/)
  assert.match(h.traceLines.join(''), /stage=asr event=final/)
  assert.doesNotMatch(h.traceLines.join(''), /private recognition text/)
})
