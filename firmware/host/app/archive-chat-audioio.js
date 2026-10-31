// Project-local adapter based on the Apache-2.0 stack-chan worker stack.
import ChatAudioIOBase from 'ChatAudioIO'
import { writePcmRing } from 'archivePcmRingWriter'
import Worker from 'worker'
import AudioIn from 'embedded:io/audio/in'
import AudioOut from 'embedded:io/audio/out'
import {PlaybackBuffer} from 'archive-playback-buffer'

const CONNECTION_ENVELOPE = '__stackchanConnectionConfiguration'

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
    if(this.input)return
    this.output?.close();this.output=null
    let input
    input=new AudioIn({sampleRate:this.inputSampleRate,onReadable:()=>{
      if(this.input!==input||!this.microphone)return
      // Read currently available bytes, rather than a stale queued notification size.
      const data=input.read()
      if(!data?.byteLength)return
      if(!this.ready){this.ready=true;if(this.state!==ChatAudioIO.DISCONNECTED)this.onStateChanged(this.state)}
      if(data.byteLength>this.inputBufferSize)return
      if(this.inputBufferOffset+data.byteLength>this.inputBufferSize)this.inputBufferOffset=0
      new Uint8Array(this.inputBuffer,this.inputBufferOffset,data.byteLength).set(new Uint8Array(data))
      let peak=0;const samples=new Int16Array(data)
      for(let i=0;i<samples.length;i++)peak=Math.max(peak,Math.abs(samples[i]))
      this.onInputLevelChanged(peak)
      if(this.state===ChatAudioIO.SPEAKING)this.worker.postMessage({id:'sendAudio',offset:this.inputBufferOffset,size:data.byteLength,channels:input.channels})
      this.inputBufferOffset+=data.byteLength
    }})
    this.input=input;input.start()
  }

  ensureOutput(){
    if(this.output)return
    this.input?.close();this.input=null;this.ready=false
    const rate=this.outputSampleRate||24000,planner=new PlaybackBuffer(this.outputBufferSize,rate)
    const health={underruns:0,bufferedMs:0,prebuffering:true}
    globalThis.stackchanPlaybackHealth=health
    let drainUntil=0,maxWritable=0,lastLevel=-1,quiet=new Uint8Array(0),output
    output=new AudioOut({sampleRate:rate,channels:1,onWritable:size=>{
      if(this.output!==output)return
      size&=~1;maxWritable=Math.max(maxWritable,size)
      const finished=this.state===ChatAudioIO.WAITING
      const plan=planner.plan(this.outputBufferHead,this.outputBufferTail,size,finished)
      health.bufferedMs=Math.round(plan.available*1000/(rate*2));health.prebuffering=plan.prebuffering
      if(health.underruns!==planner.underruns){health.underruns=planner.underruns;trace('[playback] rebuffer count='+health.underruns+'\n')}
      let peak=0
      for(const part of plan.segments){
        const samples=new Uint8Array(this.outputBuffer,part.offset,part.size)
        output.write(samples)
        const values=new Int16Array(this.outputBuffer,part.offset,part.size/2)
        for(let i=0;i<values.length;i+=8)peak=Math.max(peak,Math.abs(values[i]))
      }
      // Keep DMA supplied during prebuffer/rebuffer; never replay stale samples.
      const silence=size-plan.count;if(silence){if(quiet.byteLength<silence)quiet=new Uint8Array(silence);output.write(quiet.subarray(0,silence))}
      this.outputBufferTail=plan.next
      Atomics.store(this.barrier,0,plan.next);Atomics.notify(this.barrier,0)
      if(lastLevel!==peak){lastLevel=peak;this.onOutputLevelChanged?.(peak)}
      if(plan.complete){
        // Native write queues audio. Closing now would cut off the final syllables.
        if(!drainUntil)drainUntil=Date.now()+Math.ceil(maxWritable*1000/(rate*2))+80
        if(Date.now()>=drainUntil){this.worker.postMessage({id:'listened'});this.state=ChatAudioIO.SPEAKING;this.ensureInput();}
      }else drainUntil=0
    }})
    this.output=output;output.volume=this.volume;output.start()
  }

  createWorker(specifier, instructions, functions, voiceID, providerID, modelID, apiKey) {
    let configuration
    if (providerID && typeof providerID === 'object' && providerID[CONNECTION_ENVELOPE] === true) {
      configuration = providerID.configuration
      providerID = undefined
    }

    const usesNativePcmRing = specifier === 'xiaozhiV1'
    this.immediateInputReady = usesNativePcmRing
    if (usesNativePcmRing || specifier === 'archiveGeminiLive') this.inputSampleRate = 16000

    const worker = new Worker(specifier, {
      static: specifier==='archiveGeminiLive'?1024*1024:512*1024,
      chunk: {
        initial: 64 * 1024,
        incremental: 8 * 1024,
      },
      heap: {
        initial: 1024,
        incremental: 256,
      },
      stack: specifier==='archiveGeminiLive'?4096:1024,
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
        if(message.id==='sendAudio'){
          message={...message,channels:this.input?.channels??1}
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
