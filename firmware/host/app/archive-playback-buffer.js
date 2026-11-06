// Plan reads without dropping PCM when the network delivers uneven chunks.
export class PlaybackBuffer {
  constructor(capacity, sampleRate = 24000, prebufferMs = 600) {
    this.capacity = capacity
    this.threshold = Math.min(capacity / 2, Math.ceil((sampleRate * 2 * prebufferMs) / 1000))
    this.maxThreshold = Math.min(capacity / 2, sampleRate * 2 * 5)
    this.primed = false
    this.underruns = 0
  }
  plan(head, tail, requested, finished = false) {
    const available = head >= tail ? head - tail : this.capacity - tail + head
    if (!this.primed && (available >= this.threshold || (finished && available > 0))) this.primed = true
    if (this.primed && !finished && available < requested) {
      this.primed = false
      this.underruns++
      this.threshold = Math.min(this.maxThreshold, this.threshold * 2)
    }
    const count = this.primed ? Math.min(available, requested) & ~1 : 0
    const segments = []
    let next = tail,
      remaining = count
    while (remaining) {
      if (next === this.capacity) next = 0
      const size = Math.min(remaining, this.capacity - next)
      segments.push({ offset: next, size })
      next += size
      remaining -= size
    }
    return { segments, next, count, available, complete: finished && count === available, prebuffering: !this.primed }
  }
}

// AudioOut.Async drains non-relocatable PCM on its native priority-10 task.
// Own copies let the network ring advance without overwriting queued samples.
export class QueuedPlayback {
  constructor({ring,tail=0,rate=24000,prebufferMs=600,write,ack,now=()=>Date.now(),peak=()=>0,chunkBytes=8192,slots=16}){
    this.ring=ring;this.planner=new PlaybackBuffer(ring.byteLength,rate,prebufferMs);
    this.write=write;this.ack=ack;this.now=now;this.peak=peak;this.chunkBytes=chunkBytes;
    // One large allocation uses PSRAM on CoreS3 instead of exhausting scarce
    // internal RAM with many allocations below the IDF external-RAM threshold.
    const storage=new SharedArrayBuffer(chunkBytes*slots);
    this.free=Array.from({length:slots},(_,i)=>new Uint8Array(storage,i*chunkBytes,chunkBytes));
    this.tail=tail;this.pending=0;this.queuedBytes=0;this.active=true;this.drainMs=0;this.hardwareUntil=0;this.lastLevel=0;
  }
  pump(head,finished=false){
    if(!this.active)return {next:this.tail,complete:false};
    if(this.error)throw this.error;
    const available=()=>head>=this.tail?head-this.tail:this.ring.byteLength-this.tail+head;
    // Do not confuse an empty network ring with starvation while native PCM/DMA
    // still covers the next arriving frame. Only rebuffer after that cushion ends.
    if(this.planner.primed&&!finished&&!this.pending&&this.now()>=this.hardwareUntil&&available()<this.chunkBytes){
      this.planner.primed=false;this.planner.underruns++;
      this.planner.threshold=Math.min(this.planner.maxThreshold,this.planner.threshold*2);
    }
    while(this.free.length&&available()){
      const amount=available();
      if(this.planner.primed&&!finished&&amount<this.chunkBytes&&(this.pending||this.now()<this.hardwareUntil))break;
      const plan=this.planner.plan(head,this.tail,Math.min(amount,this.chunkBytes),finished);
      if(!plan.count)break;
      const slot=this.free.pop();let offset=0;
      for(const part of plan.segments){slot.set(new Uint8Array(this.ring,part.offset,part.size),offset);offset+=part.size;}
      const bytes=slot.subarray(0,plan.count),level=this.peak(bytes);
      this.pending++;this.queuedBytes+=bytes.byteLength;
      let completed=false;
      try{
        this.write(bytes,error=>{
          if(!this.active||completed)return;
          completed=true;
          this.pending--;this.queuedBytes-=bytes.byteLength;this.free.push(slot);
          this.hardwareUntil=this.now()+this.drainMs;
          this.lastLevel=level;if(error)this.error=error;
        });
      }catch(error){if(!completed){this.pending--;this.queuedBytes-=bytes.byteLength;this.free.push(slot);}throw error;}
      if(this.error)throw this.error;
      this.tail=plan.next;this.ack(this.tail);
    }
    return {next:this.tail,available:available(),queuedBytes:this.queuedBytes,prebuffering:!this.planner.primed,underruns:this.planner.underruns,complete:finished&&!available()&&!this.pending};
  }
  close(){this.active=false;this.free.length=0;this.ring=null;this.write=null;this.ack=null;this.peak=null;}
}
