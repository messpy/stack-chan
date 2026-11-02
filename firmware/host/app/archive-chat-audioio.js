// Project-local adapter based on the Apache-2.0 stack-chan worker stack.

import { writePcmRing } from 'archivePcmRingWriter'
import ChatAudioIOBase from 'ChatAudioIO'
import AudioIn from 'embedded:io/audio/in'
import AudioOut from 'embedded:io/audio/out'
import { QueuedPlayback } from 'archive-playback-buffer'
import Worker from 'worker'
import Timer from 'timer'

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
    if (this.closed || this.input) return
    this.closePlayback()
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
    // Metering is only for UI; scan sparsely across both stereo channels.
    // Recognition still receives every captured sample unchanged.
    this.onInputLevelChanged(pcmPeak(new Int16Array(data), 17))
    if (this.state === ChatAudioIO.SPEAKING) {
      this.worker.postMessage({
        id: 'sendAudio',
        offset: this.inputBufferOffset,
        size: data.byteLength,
        channels: input.channels,
        capturedAt: Date.now(),
      })
    }
    this.inputBufferOffset += data.byteLength
  }

  deferTerminalPlayback(state,error=''){
    const playback=this.playback
    if(!this.output||!playback||!(playback.queue.pending||this.outputBufferHead!==this.outputBufferTail||playback.queue.hardwareUntil))return false
    playback.terminal={state,error};this.state=ChatAudioIO.WAITING
    return true
  }

  disconnected(){
    if(this.closed||this.deferTerminalPlayback(ChatAudioIO.DISCONNECTED))return
    this.releaseAudio();this.state=ChatAudioIO.DISCONNECTED;this.onStateChanged(this.state)
  }
  releaseAudio(){
    this.closePlayback()
    const input=this.input,output=this.output;this.input=null;this.output=null;this.ready=false
    try{input?.close()}finally{output?.close()}
  }

  failed(message){
    const reason=String(message?.string||'')
    if(/network|connection.*clos|socket|disconnect/i.test(reason)&&this.deferTerminalPlayback(ChatAudioIO.FAILED,reason))return
    if(this.closed)return
    this.releaseAudio();this.error=reason;this.state=ChatAudioIO.FAILED;this.onStateChanged(this.state)
  }

  closePlayback(){
    const playback=this.playback;this.playback=undefined;
    if(playback){Timer.clear(playback.timer);playback.queue.close();}
  }

  close(){
    if(this.closed)return
    this.closed=true
    try{this.releaseAudio()}finally{
      try{this.worker?.terminate()}finally{this.worker=null;this.inputBuffer=null;this.outputBuffer=null;this.barrier=null}
    }
  }

  ensureOutput() {
    if (this.output) return
    this.input?.close();this.input=null;this.ready=false
    const rate=this.outputSampleRate||24000
    // Async inherits the SDK base class, bypassing CoreS3's synchronous wrapper.
    if(globalThis.amp)globalThis.amp.sampleRate=rate
    // Six <=4096-byte DMA descriptors in the ESP32 driver: conservatively
    // retain the output for all of them after the final native completion.
    const drainBytes=6*4096
    const playback={rate,drainUntil:0,maxWritable:drainBytes,lastLevel:-1,health:{underruns:0,bufferedMs:0,queuedMs:0,prebuffering:true,mode:'native-async',maximumPumpGapMs:0}}
    const output=new AudioOut.Async({sampleRate:rate,channels:1,onWritable:size=>{
      playback.maxWritable=Math.max(playback.maxWritable,size&~1)
      if(playback.queue)playback.queue.drainMs=Math.ceil(playback.maxWritable*1000/(rate*2))+80
    }})
    playback.output=output
    playback.queue=new QueuedPlayback({ring:this.outputBuffer,tail:this.outputBufferTail,rate,prebufferMs:this.playbackPrebufferMs??600,
      write:(bytes,done)=>output.write(bytes,done),now:()=>Date.now(),
      ack:next=>{this.outputBufferTail=next;Atomics.store(this.barrier,0,next);Atomics.notify(this.barrier,0)},
      peak:bytes=>pcmPeak(new Int16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2),8)})
    playback.queue.drainMs=Math.ceil(drainBytes*1000/(rate*2))+80
    this.output=output;this.playback=playback
    globalThis.stackchanPlaybackHealth=playback.health
    output.volume=this.volume
    playback.timer=Timer.repeat(()=>this.pumpPlayback(output,playback),20)
    this.pumpPlayback(output,playback)
    if(this.output===output)output.start()
  }

  pumpPlayback(output,playback){
    if(this.output!==output)return
    try{
      const plan=playback.queue.pump(this.outputBufferHead,this.state===ChatAudioIO.WAITING)
      const health=playback.health,now=Date.now()
      if(playback.lastPumpAt!==undefined)health.maximumPumpGapMs=Math.max(health.maximumPumpGapMs,now-playback.lastPumpAt)
      playback.lastPumpAt=now
      if(health.underruns!==plan.underruns)trace('[playback] native queue starvation count='+plan.underruns+'\n')
      health.underruns=plan.underruns;health.bufferedMs=Math.round(plan.available*1000/(playback.rate*2));
      health.queuedMs=Math.round(plan.queuedBytes*1000/(playback.rate*2));health.prebuffering=plan.prebuffering
      if(playback.lastLevel!==playback.queue.lastLevel){playback.lastLevel=playback.queue.lastLevel;this.onOutputLevelChanged?.(playback.lastLevel)}
      this.finishPlayback(playback,plan.complete)
    }catch(error){this.closePlayback();this.failed({string:'Audio playback failed: '+String(error?.message||error)})}
  }

  finishPlayback(playback, complete) {
    if (!complete) {
      playback.drainUntil = 0
      return
    }
    // Native writes queue audio; keep output alive until the final samples drain.
    if (!playback.drainUntil)
      playback.drainUntil = Date.now() + Math.ceil((playback.maxWritable * 1000) / (playback.rate * 2)) + 80
    if (Date.now() >= playback.drainUntil && !playback.resuming) {
      playback.resuming=true
      // Leave the AudioOut native callback before closing I2S, constructing
      // AudioIn and running state/UI callbacks on the native C stack.
      Timer.set(()=>{
        if(this.output!==playback.output||this.state!==ChatAudioIO.WAITING||!this.worker)return
        playback.health.drained=true
        if(playback.terminal){
          const terminal=playback.terminal;this.closePlayback();this.output?.close();this.output=null;
          this.state=terminal.state;this.error=terminal.error;this.onStateChanged(this.state);return
        }
        this.worker.postMessage({id:'listened'})
        this.state=ChatAudioIO.SPEAKING
        this.ensureInput()
      },0)
    }
  }

  createWorker(specifier, instructions, functions, voiceID, providerID, modelID, apiKey, recognitionOnly=false) {
    let configuration
    if (providerID && typeof providerID === 'object' && providerID[CONNECTION_ENVELOPE] === true) {
      configuration = providerID.configuration
      providerID = undefined
    }

    this.playbackPrebufferMs = specifier === 'archiveGeminiLive' ? 2000 : 1500
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
      // Fit the internal heap after reconnect; fail-fast SDK guard handles exhaustion.
      nativeStack: 24 * 1024,
      priority: 4,
    })
    // Shared PCM ring (~1.92 s of 16 kHz mono). Main writes via native
    // downmix; the Opus task reads it. Do not copy samples in JS or wait
    // for a Worker ACK — both previously dropped mic frames.
    const PCM_FRAME_BYTES = 1920
    const PCM_RING_BYTES = PCM_FRAME_BYTES * 32 + 2
    const PCM_RING_STATE_BYTES = 4 * 4
    this.worker = { terminate: () => {worker.onmessage=undefined;worker.terminate()} }
    try {
    const pcmRing = usesNativePcmRing ? new SharedArrayBuffer(PCM_RING_BYTES) : undefined
    const pcmRingState = usesNativePcmRing ? new SharedArrayBuffer(PCM_RING_STATE_BYTES) : undefined

    this.worker = {
      terminate: () => {worker.onmessage=undefined;worker.terminate()},
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
      if(this.closed)return
      if (message.id === 'audioConsumed') return
      const handler = this[message.id]
      if (typeof handler === 'function') {
        try{handler.call(this, message)}catch(error){this.failed({string:'Audio pipeline failed: '+String(error?.message||error)})}
        return
      }
      trace(`[chat] ignored worker message: ${String(message.id)}\n`)
    }
    this.worker.postMessage({
      id: 'configure',
      recognitionOnly,
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
    } catch(error) { this.close(); throw error }
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

// Local-only option; never advertised as an unsupported cloud protocol feature.
export class XiaoZhiRecognitionIO extends ChatAudioIO {
 createWorker(...args){return super.createWorker(...args,true)}
}
