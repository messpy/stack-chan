// One half-duplex wire is shared by both axes. Hold it until reply/turnaround.
export default class ServoBusQueue {
  #pending: Array<{ run: (done: () => void) => void; failed: (error: unknown) => void }> = []
  #busy = false
  #setTimer: (fn: () => void, delay: number) => unknown
  constructor(setTimer: (fn: () => void, delay: number) => unknown) { this.#setTimer = setTimer }
  submit(run: (done: () => void) => void, failed: (error: unknown) => void) {
    this.#pending.push({run,failed})
    this.#drain()
  }
  #drain = () => {
    if(this.#busy)return
    const work=this.#pending.shift();if(!work)return
    this.#busy=true
    let finished=false
    const done=()=>{if(finished)return;finished=true;this.#busy=false;this.#setTimer(this.#drain,0)}
    try{work.run(done)}catch(error){try{work.failed(error)}finally{done()}}
  }
}
