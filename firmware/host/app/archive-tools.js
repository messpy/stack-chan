import {headMoveTool,moveHead} from 'archive-head-motion';
import {getVolume,setVolume} from 'archive-volume';
import Time from 'time';
import {nextDailyDue,japaneseClock,finishReminder} from 'archive-reminder-time';
import {playAlarmSound,stopAlarmSound} from 'archive-alarm-sound';
import Timer from 'timer';
import Resource from 'Resource';
import {getSettings,changeSettings,randomHex} from 'archive-vault';
let definitions;
const liveTimers=new Map();
const elapsedTimer=t=>Math.min(t.duration,(Time.ticks-t.started)>>>0);
let alarmDisplay,alarmMotion;
export function setAlarmMotion(factory){alarmMotion=factory;}
export function setAlarmDisplay(display){alarmDisplay=display;}
const volumeTools=[{name:'volume_get',description:'本体の現在の音量を取得する。',inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'volume_set',description:'ユーザーが依頼した本体音量を0〜100%で指定する。',inputSchema:{type:'object',properties:{percent:{type:'integer',minimum:0,maximum:100}},required:['percent'],additionalProperties:false}}];
const toolDefinitions=()=>definitions??(definitions=JSON.parse(String.fromArrayBuffer(new Resource('reminder-tools.txt'))).concat(headMoveTool,volumeTools));
let robot,claim,release,ringing=false,stopped=false;
const ready=()=>Date.now()>1700000000000;
const localTime=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,19)+'+09:00';
const wait=ms=>new Promise(resolve=>Timer.set(resolve,ms));
const compact=rows=>rows.filter(row=>row.status==='scheduled'||row.status==='pending').concat(rows.filter(row=>row.status!=='scheduled'&&row.status!=='pending').slice(-20));
export function listDeviceTools(){return toolDefinitions();}
export function reminderStatus(){return {clockReady:ready(),timezone:'Asia/Tokyo',now:Date.now(),localTime:ready()?localTime():null,ringing,items:getSettings().reminders.map(row=>liveTimers.has(row.id)?{...row,remainingMs:liveTimers.get(row.id).duration-elapsedTimer(liveTimers.get(row.id))}:row)};}
export function callDeviceTool(name,args={}){
  if(!toolDefinitions().some(tool=>tool.name===name))throw new Error('Unknown device tool');
  if(name==='head_move')return moveHead(robot,args);
  if(name==='volume_get')return getVolume();
  if(name==='volume_set')return setVolume(args.percent);
  if(name==='clock_now')return {clockReady:ready(),timezone:'Asia/Tokyo',localTime:ready()?localTime():null,utc:ready()?new Date().toISOString():null};
  if(name==='reminder_list')return {...reminderStatus(),items:reminderStatus().items.filter(row=>args.include_completed||row.status==='scheduled'||row.status==='pending')};
  if(name==='alarm_stop'){stopped=true;stopAlarmSound();return {stopping:ringing};}
  if(name==='reminder_cancel'){
    const id=String(args.id??'');const job=getSettings().reminders.find(row=>row.id===id);
    if(!job)throw new Error('指定した予約が見つかりません');
    changeSettings(data=>{data.reminders=data.reminders.map(row=>row.id===id?{...row,status:'cancelled'}:row);});
    if(job.status==='pending'){stopped=true;stopAlarmSound();}
    return {cancelled:true,id};
  }
  if(name!=='timer_create'&&!ready())throw new Error('本体の時刻が未同期です。Wi-FiかUSBで時刻を同期してください');
  if(getSettings().reminders.filter(row=>row.status==='scheduled'||row.status==='pending').length>=16)throw new Error('予約は16件までです');
  if(args.repeat!==undefined&&!['once','daily'].includes(args.repeat))throw new Error('繰り返しは1回か毎日を指定してください');
  if(name==='timer_create'&&args.repeat==='daily')throw new Error('毎日繰り返す場合はアラームを使ってください');
  let due;
  if(name==='timer_create'){
    if(!Number.isInteger(args.seconds)||args.seconds<1||args.seconds>604800)throw new Error('タイマーは1秒から7日までです');
    due=Date.now()+args.seconds*1000;
  }else{
    if(typeof args.when!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(args.when))throw new Error('タイムゾーン付きの日時を指定してください');
    due=Date.parse(args.when);
    if(!Number.isFinite(due)||due<=Date.now())throw new Error('未来の日時を指定してください');
  }
  const title=String(args.title??(name==='timer_create'?'タイマー':'アラーム')).slice(0,80);
  const item={id:Date.now()+'-'+randomHex().slice(0,8),kind:name==='timer_create'?'timer':'alarm',title,due,status:'scheduled',created:Date.now()};
  if(name==='alarm_create'){item.repeat=args.repeat||'once';if(item.repeat==='daily')Object.assign(item,japaneseClock(due));}
  if(name==='timer_create'&&!ready())item.clockPending=true;
  changeSettings(data=>{data.reminders=compact(data.reminders);data.reminders.push(item);});
  if(name==='timer_create')liveTimers.set(item.id,{started:Time.ticks,duration:args.seconds*1000});
  trace('[tools] '+item.kind+' scheduled id='+item.id+(item.kind==='timer'?' seconds='+args.seconds:'')+'\n');
  return item;
}
async function notify(item){
  let dance,motionDone;
  ringing=true;stopped=false;trace('[tools] '+item.kind+' notification begin id='+item.id+'\n');
  try{
    // Persist before touching audio: a reset must never replay this occurrence forever.
    changeSettings(data=>{data.reminders=data.reminders.map(row=>row.id===item.id&&row.status==='pending'?{...row,notificationStarted:Date.now()}:row);});
    try{robot.lightRainbow?.('head');}catch(_){trace('[tools] rainbow LED unavailable\n');}
    let visible=false;try{visible=alarmDisplay?.show(item)===true;}catch(_){trace('[tools] alarm screen unavailable\n');}if(!visible)robot.showBalloon(item.title);
    try{dance=alarmMotion?.(()=>stopped);motionDone=dance?.finished.catch(()=>trace('[tools] alarm motion failed\n'));}catch(_){trace('[tools] alarm motion unavailable\n');}
    let custom=false;try{custom=await playAlarmSound(robot,()=>stopped,0,item.kind);}catch(_){trace('[tools] custom sound unavailable; tone fallback\n');}
    if(!custom)for(let i=0;i<12&&!stopped;i++){
      await robot.audio.tone(i%2?660:880,180,Math.min(robot.audio.volume,0.45));
      await wait(180);
    }
    changeSettings(data=>{data.reminders=data.reminders.map(row=>row.id===item.id&&row.status==='pending'?{...finishReminder(row,Date.now()),notificationStarted:undefined}:row);});
    trace('[tools] '+item.kind+' notification completed id='+item.id+'\n');
  }catch(error){
    trace('[tools] reminder notification failed: '+String(error)+'\n');
    changeSettings(data=>{data.reminders=data.reminders.map(row=>row.id===item.id&&row.status==='pending'?interruptedReminder(row):row);});
  }
  finally{dance?.stop();try{await motionDone;}catch(_){}try{robot.lightOff?.('head');}catch(_){}try{alarmDisplay?.close();}catch(_){}robot.hideBalloon();ringing=false;release();}
}
function interruptedReminder(row){
  const next=row.repeat==='daily'?{...row,status:'scheduled',due:ready()?nextDailyDue(Date.now(),row.hour,row.minute):row.due+86400000}:{...row,status:'cancelled'};
  return {...next,notificationStarted:undefined,reason:'通知中に再起動または再生エラーが発生したため、この回の通知を停止しました'};
}
export function startDeviceTools(context,acquire,unlock){
  robot=context;claim=acquire;release=unlock;
  if(getSettings().reminders.some(row=>row.status==='pending'&&row.notificationStarted!==undefined)){
    changeSettings(data=>{data.reminders=data.reminders.map(row=>row.status==='pending'&&row.notificationStarted!==undefined?interruptedReminder(row):row);});
    trace('[tools] interrupted notification recovered; replay suppressed\n');
  }
  Timer.repeat(()=>{
    try{
      let changed=false;const now=Date.now();
      const timers=getSettings().reminders.map(row=>{
        if(row.kind!=='timer'||row.status!=='scheduled'){liveTimers.delete(row.id);return row;}
        const live=liveTimers.get(row.id);
        if(!live)return row.clockPending?(changed=true,{...row,status:'cancelled',reason:'時計未設定のタイマーは再起動で解除されました'}):row;
        const remaining=live.duration-elapsedTimer(live);
        if(remaining<=0){changed=true;liveTimers.delete(row.id);return {...row,status:'pending',clockPending:false};}
        if(ready()&&(row.clockPending||Math.abs(row.due-(now+remaining))>2000)){changed=true;return {...row,due:now+remaining,clockPending:false};}
        return row;
      });
      if(changed)changeSettings(data=>{data.reminders=timers;});

      if(ready()&&getSettings().reminders.some(row=>row.status==='scheduled'&&!liveTimers.has(row.id)&&row.due<=Date.now())){
        changeSettings(data=>{data.reminders=data.reminders.map(row=>row.status==='scheduled'&&!liveTimers.has(row.id)&&row.due<=Date.now()?(row.repeat==='daily'&&Date.now()-row.due>300000?{...row,due:nextDailyDue(Date.now(),row.hour,row.minute)}:{...row,status:'pending'}):row);});
      }
      const pending=getSettings().reminders.find(row=>row.status==='pending');
      if(pending&&!ringing&&claim())void notify(pending);
    }catch(_){trace('[tools] reminder storage unavailable\n');}
  },1000);
  robot.drawer.addDrawerButton({key:'alarmStop',label:'アラーム音を停止',callback:()=>{stopped=true;stopAlarmSound();}});
}
