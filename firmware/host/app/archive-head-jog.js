// Browser press-and-hold motion. A short lease bounds movement after link loss.
export const HEAD_JOG_LIMITS = Object.freeze({ minY: -Math.PI/3, maxY: Math.PI/3, minP: -Math.PI/3, maxP: -Math.PI/36 })
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value))
export function createHeadJog(robot,{now,repeat,cancel,log=()=>{}}) {
  let rotation, direction='', sequence=-1, expires=0, last=now(), pending, closed=false, limit=false, error='', generation=0
  const directions={up:['p',-1],down:['p',1],left:['y',1],right:['y',-1]}
  const state=()=>({ready:!!rotation,moving:!!direction&&!limit,atLimit:limit,rotation:rotation?{...rotation}:null,error})
  function stop(reason='released'){if(direction)log('stop '+reason);direction='';limit=false;generation++;return state()}
  function seed(value){
    if(closed)return
    if(!value||!Number.isFinite(value.y)||!Number.isFinite(value.p))throw Error('首の位置を取得できませんでした')
    rotation={y:value.y,p:value.p,r:0}
    error='';last=now()
  }
  function hold(args){
    if(closed)throw Error('首の操作は終了しています')
    if(!Number.isSafeInteger(args.sequence)||args.sequence<0||typeof args.held!=='boolean')throw Error('首の操作情報が正しくありません')
    if(args.held&&!Object.hasOwn(directions,args.direction))throw Error('向きを選んでください')
    if(args.sequence<sequence)return state()
    if(args.sequence===sequence&&!direction)return state() // a late renewal cannot revive a released press
    if(!args.held){sequence=args.sequence;return stop()}
    if(error)throw Error(error)
    if(args.sequence>sequence||direction!==args.direction){generation++;last=now();limit=false;log('start '+args.direction)}
    sequence=args.sequence;direction=args.direction;expires=now()+750
    return state()
  }
  async function step(){
    if(closed||!direction)return
    if(now()>=expires){stop('lease expired');return}
    if(!rotation||pending)return
    const elapsed=Math.min(100,Math.max(0,now()-last));last=now()
    if(!elapsed)return
    const [axis,sign]=directions[direction],next={...rotation}
    const amount=sign*(Math.PI/9)*elapsed/1000 // 20 degrees per second
    const min=axis==='y'?HEAD_JOG_LIMITS.minY:HEAD_JOG_LIMITS.minP,max=axis==='y'?HEAD_JOG_LIMITS.maxY:HEAD_JOG_LIMITS.maxP
    // If an earlier absolute command was outside the manual range, allow a
    // gradual return inward, never jump straight to the manual endpoint.
    next[axis]=rotation[axis]<min?(amount>0?Math.min(max,rotation[axis]+amount):rotation[axis]):rotation[axis]>max?(amount<0?Math.max(min,rotation[axis]+amount):rotation[axis]):clamp(rotation[axis]+amount,min,max)
    const reached=next[axis]===rotation[axis]
    if(reached&&!limit)log('limit '+direction)
    limit=reached
    if(limit)return // no repeated position writes against an endpoint
    const ticket=generation
    pending=(async()=>{
      robot.lookAway()
      await robot.setTorque(true)
      if(closed||ticket!==generation||!direction||now()>=expires)return
      rotation=next
      await robot.setPose({...robot.pose.body,rotation:next},.1)
    })()
    try{await pending}catch(_){error='首の操作に失敗しました';stop()}finally{pending=null}
  }
  const timer=repeat(()=>{void step()},50)
  return {hold,state,seed,stop,fail(message){error=message;stop()},reset(value){stop();seed(value)},async close(){closed=true;stop();cancel(timer);if(pending)await pending.catch(()=>{})}}
}
