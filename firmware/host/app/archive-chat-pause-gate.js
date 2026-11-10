// Reference-counted pause lease: a capture/monitor cannot reconnect audio
// until every holder has finished, regardless of elapsed time.
export function createChatPauseGate({pause, resume}) {
  let count=0
  return {
    get active(){return count>0},
    get count(){return count},
    hold(reason='capture'){
      if(count===0)pause(reason)
      count++
      let released=false
      return ()=>{
        if(released)return
        released=true
        count--
        if(count===0)resume(reason)
      }
    },
  }
}
