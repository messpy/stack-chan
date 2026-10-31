// Plan reads without dropping PCM when the network delivers uneven chunks.
export class PlaybackBuffer {
  constructor(capacity, sampleRate=24000, prebufferMs=600){
    this.capacity=capacity;this.threshold=Math.min(capacity/2,Math.ceil(sampleRate*2*prebufferMs/1000));this.primed=false;this.underruns=0;
  }
  plan(head,tail,requested,finished=false){
    const available=head>=tail?head-tail:this.capacity-tail+head;
    if(!this.primed&&(available>=this.threshold||(finished&&available>0)))this.primed=true;
    if(this.primed&&!finished&&available<requested){this.primed=false;this.underruns++;}
    const count=this.primed?Math.min(available,requested)&~1:0;
    const segments=[];let next=tail,remaining=count;
    while(remaining){if(next===this.capacity)next=0;const size=Math.min(remaining,this.capacity-next);segments.push({offset:next,size});next+=size;remaining-=size;}
    return {segments,next,count,available,complete:finished&&count===available,prebuffering:!this.primed};
  }
}
