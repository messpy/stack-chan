import Timer from 'timer';
const wait=ms=>new Promise(resolve=>Timer.set(resolve,ms));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function createAlarmDance(robot,{rotation,stopped=()=>false}={}){
  let cancelled=false;
  const pose={...robot.pose.body,position:{...robot.pose.body.position}};
  const base={...(rotation||robot.pose.body.rotation)};
  const done=()=>cancelled||stopped();
  const finished=(async()=>{
    try{
      await robot.setTorque(true);
      while(!done()){
        for(const [yaw,pitch] of [[.16,-.06],[-.16,-.06],[.08,.025],[-.08,.025]]){
          if(done())break;
          const next={...base,y:clamp(base.y+yaw,-1.04,1.04),p:clamp(base.p+pitch,-.45,.30)};
          await robot.setPose({...pose,rotation:next},.3);
          await wait(420);
        }
      }
    }finally{
      try{await robot.setPose({...pose,rotation:base},.3);await wait(350);}
      finally{await robot.setTorque(false);}
    }
  })();
  return {stop(){cancelled=true;},finished};
}
