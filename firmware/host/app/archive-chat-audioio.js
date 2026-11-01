// Project-local adapter based on the Apache-2.0 stack-chan worker stack.

import { writePcmRing } from 'archivePcmRingWriter'
import ChatAudioIOBase from 'ChatAudioIO'
import AudioIn from 'embedded:io/audio/in'
import AudioOut from 'embedded:io/audio/out'
import { PlaybackBuffer } from 'archive-playback-buffer'
import Worker from 'worker'

const CONNECTION_ENVELOPE = '__stackchanConnectionConfiguration'

function pcmPeak(samples, stride = 1) {
  let peak = 0
  for (let i = 0; i < samples.length; i += stride) peak = Math.max(peak, Math.abs(samples[i]))
  return peak
}

export default class ChatAudioIO extends ChatAudioIOBase {
  constructor(options = {}) {
    const providerID =
      options.configuration === undefined
        ? options.providerID
        : {
            [CONNECTION_ENVELOPE]: true,
            configuration: options.configuration,
          }
    super({ ...options, providerID })
    const callback = () => {}
    this.onEmotionChanged = options.onEmotionChanged ?? callback
    this.onAlert = options.onAlert ?? callback
    this.onSystemCommand = options.onSystemCommand ?? callback
    this.onCustomEvent = options.onCustomEvent ?? callback
    this.onUnknownEvent = options.onUnknownEvent ?? callback
    this.onProtocolWarning = options.onProtocolWarning ?? callback
    this.onMcpNotification = options.onMcpNotification ?? callback
    this.onMcpResponse = options.onMcpResponse ?? callback
    this.onGlyphPush = options.onGlyphPush ?? callback
  }

  ensureInput() {
    if (this.input) return
    this.output?.close()
    this.output = null
    const input = new AudioIn({
      sampleRate: this.inputSampleRate,
      onReadable: () => this.captureInput(input),
    })
    this.input = input
    input.start()
  }

  captureInput(input) {
    if (this.input !== input || !this.microphone) return
    // Queued notifications may contain stale sizes; read current availability.
    const data = input.read()
    if (!data?.byteLength) return
    if (!this.ready) {
      this.ready = true
      if (this.state !== ChatAudioIO.DISCONNECTED) this.onStateChanged(this.state)
    }
    if (data.byteLength > this.inputBufferSize) return
    if (this.inputBufferOffset + data.byteLength > this.inputBufferSize) this.inputBufferOffset = 0
    new Uint8Array(this.inputBuffer, this.inputBufferOffset, data.byteLength).set(new Uint8Array(data))
    this.onInputLevelChanged(pcmPeak(new Int16Array(data)))
    if (this.state === ChatAudioIO.SPEAKING) {
      this.worker.postMessage({
        id: 'sendAudio',
        offset: this.inputBufferOffset,
        size: data.byteLength,
        channels: input.channels,
      })
    }
    this.inputBufferOffset += data.byteLength
  }

  ensureOutput() {
    if (this.output) return
    this.input?.close()
    this.input = null
    this.ready = false
    const rate = this.outputSampleRate || 24000
    const playback = {
      rate,
      planner: new PlaybackBuffer(this.outputBufferSize, rate, this.playbackPrebufferMs ?? 600),
      health: { underruns: 0, bufferedMs: 0, prebuffering: true },
      drainUntil: 0,
      maxWritable: 0,
      lastLevel: -1,
      quiet: new Uint8Array(0),
    }
    globalThis.stackchanPlaybackHealth = playback.health
    const output = new AudioOut({
      sampleRate: rate,
      channels: 1,
      onWritable: (size) => this.writePlayback(output, playback, size),
    })
    this.output = output
    output.volume = this.volume
    output.start()
  }

  writePlayback(output, playback, size) {
    if (this.output !== output) return
    size &= ~1
    playback.maxWritable = Math.max(playback.maxWritable, size)
    const { planner, health, rate } = playback
    const plan = planner.plan(this.outputBufferHead, this.outputBufferTail, size, this.state === ChatAudioIO.WAITING)
    health.bufferedMs = Math.round((plan.available * 1000) / (rate * 2))
    health.prebuffering = plan.prebuffering
    if (health.underruns !== planner.underruns) {
      health.underruns = planner.underruns
      trace('[playback] rebuffer count=' + health.underruns + '\n')
    }
    const peak = this.writePlaybackSegments(output, plan.segments)
    this.writePlaybackSilence(output, playback, size - plan.count)
    this.outputBufferTail = plan.next
    Atomics.store(this.barrier, 0, plan.next)
    Atomics.notify(this.barrier, 0)
    if (playback.lastLevel !== peak) {
      playback.lastLevel = peak
      this.onOutputLevelChanged?.(peak)
    }
    this.finishPlayback(playback, plan.complete)
  }

  writePlaybackSegments(output, segments) {
    let peak = 0
    for (const part of segments) {
      output.write(new Uint8Array(this.outputBuffer, part.offset, part.size))
      peak = Math.max(peak, pcmPeak(new Int16Array(this.outputBuffer, part.offset, part.size / 2), 8))
    }
    return peak
  }

  writePlaybackSilence(output, playback, size) {
    if (!size) return
    // Reuse zero-filled memory; never replay old PCM while buffering.
    if (playback.quiet.byteLength < size) playback.quiet = new Uint8Array(size)
    output.write(playback.quiet.subarray(0, size))
  }

  finishPlayback(playback, complete) {
    if (!complete) {
      playback.drainUntil = 0
      return
    }
    // Native writes queue audio; keep output alive until the final samples drain.
    if (!playback.drainUntil)
      playback.drainUntil = Date.now() + Math.ceil((playback.maxWritable * 1000) / (playback.rate * 2)) + 80
    if (Date.now() >= playback.drainUntil) {
      this.worker.postMessage({ id: 'listened' })
      this.state = ChatAudioIO.SPEAKING
      this.ensureInput()
    }
  }

  createWorker(specifier, instructions, functions, voiceID, providerID, modelID, apiKey) {
    let configuration
    if (providerID && typeof providerID === 'object' && providerID[CONNECTION_ENVELOPE] === true) {
      configuration = providerID.configuration
      providerID = undefined
    }

    this.playbackPrebufferMs = specifier === 'archiveGeminiLive' ? 2000 : 600
    const usesNativePcmRing = specifier === 'xiaozhiV1'
    this.immediateInputReady = usesNativePcmRing
    if (usesNativePcmRing || specifier === 'archiveGeminiLive') this.inputSampleRate = 16000

    const worker = new Worker(specifier, {
      static: specifier === 'archiveGeminiLive' ? 1024 * 1024 : 512 * 1024,
      chunk: {
        initial: 64 * 1024,
        incremental: 8 * 1024,
      },
      heap: {
        initial: 1024,
        incremental: 256,
      },
      stack: specifier === 'archiveGeminiLive' ? 4096 : 1024,
      nativeStack: 40 * 1024,
      priority: 4,
    })
    // Shared PCM ring (~1.92 s of 16 kHz mono). Main writes via native
    // downmix; the Opus task reads it. Do not copy samples in JS or wait
    // for a Worker ACK — both previously dropped mic frames.
    const PCM_FRAME_BYTES = 1920
    const PCM_RING_BYTES = PCM_FRAME_BYTES * 32 + 2
    const PCM_RING_STATE_BYTES = 4 * 4
    const pcmRing = usesNativePcmRing ? new SharedArrayBuffer(PCM_RING_BYTES) : undefined
    const pcmRingState = usesNativePcmRing ? new SharedArrayBuffer(PCM_RING_STATE_BYTES) : undefined

    this.worker = {
      terminate: () => worker.terminate(),
      postMessage: (message) => {
        if (message.id === 'sendAudio') {
          message = { ...message, channels: this.input?.channels ?? 1 }
          globalThis.stackchanMicrophoneActivity?.()
        }
        if (message.id !== 'sendAudio' || !usesNativePcmRing) {
          worker.postMessage(message)
          return
        }
        if (!this.inputBuffer || !pcmRing || !pcmRingState) return
        try {
          writePcmRing(pcmRing, pcmRingState, this.inputBuffer, message.offset, message.size, message.channels ?? 1)
        } catch (error) {
          this.failed({ string: `PCM ring write failed: ${String(error?.message ?? error)}` })
        }
      },
    }
    worker.onmessage = (message) => {
      if (message.id === 'audioConsumed') return
      const handler = this[message.id]
      if (typeof handler === 'function') {
        handler.call(this, message)
        return
      }
      trace(`[chat] ignored worker message: ${String(message.id)}\n`)
    }
    this.worker.postMessage({
      id: 'configure',
      configuration,
      pcmRing,
      pcmRingState,
      // Legacy fields remain available to existing ChatAudioIO workers.
      instructions,
      functions,
      voiceID,
      providerID,
      modelID,
      apiKey,
    })
    this.ensureInput()
  }

  startListening(mode = 'auto') {
    this.worker?.postMessage({ id: 'startListening', mode })
  }

  stopListening() {
    this.worker?.postMessage({ id: 'stopListening' })
  }

  notifyWakeWordDetected(text) {
    this.worker?.postMessage({ id: 'detectWakeWord', text })
  }

  abort(reason) {
    this.worker?.postMessage({ id: 'abort', reason })
  }

  sendMcpMessage(payload) {
    this.worker?.postMessage({ id: 'sendMcpMessage', payload })
  }

  receiveEmotion(message) {
    this.onEmotionChanged(message.emotion ?? '', message.text)
  }

  receiveAlert(message) {
    this.onAlert({ status: message.status, message: message.message ?? '', emotion: message.emotion })
  }

  receiveSystemCommand(message) {
    this.onSystemCommand({ command: message.command ?? '', event: message.event ?? {} })
  }

  receiveCustomEvent(message) {
    this.onCustomEvent({ payload: message.payload, event: message.event ?? {} })
  }

  receiveUnknownEvent(message) {
    this.onUnknownEvent(message.event ?? {})
  }

  protocolWarning(message) {
    this.onProtocolWarning(message.string ?? 'protocol warning', message.event)
  }

  receiveMcpNotification(message) {
    this.onMcpNotification(message.payload ?? {})
  }

  receiveMcpResponse(message) {
    this.onMcpResponse(message.payload ?? {})
  }

  receiveGlyphPush(message) {
    this.onGlyphPush({ source: message.source, text: message.text, payload: message.payload ?? {} })
  }
}
