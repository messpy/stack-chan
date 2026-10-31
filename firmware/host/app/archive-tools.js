import {nextDailyDue,japaneseClock,finishReminder} from 'archive-reminder-time';
import {playAlarmSound,stopAlarmSound} from 'archive-alarm-sound';
import Timer from 'timer';
import Resource from 'Resource';
import {getSettings,changeSettings,randomHex} from 'archive-vault';
let definitions;
let alarmDisplay;
export function setAlarmDisplay(display){alarmDisplay=display;}
const toolDefinitions=()=>definitions??(definitions=JSON.parse(String.fromArrayBuffer(new Resource('reminder-tools.txt'))));
let robot,claim,release,ringing=false,stopped=false;
const ready=()=>Date.now()>1700000000000;
const localTime=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,19)+'+09:00';
const wait=ms=>new Promise(resolve=>Timer.set(resolve,ms));
const compact=rows=>rows.filter(row=>row.status==='scheduled'||row.status==='pending').concat(rows.filter(row=>row.status!=='scheduled'&&row.status!=='pending').slice(-20));
export function listDeviceTools(){return toolDefinitions();}
export function reminderStatus(){return {clockReady:ready(),timezone:'Asia/Tokyo',now:Date.now(),localTime:ready()?localTime():null,ringing,items:getSettings().reminders};}
export function callDeviceTool(name,args={}){
  if(!toolDefinitions().some(tool=>tool.name===name))throw new Error('Unknown device tool');
  if(name==='clock_now')return {clockReady:ready(),timezone:'Asia/Tokyo',localTime:ready()?localTime():null,utc:ready()?new Date().toISOString():null};
  if(name==='reminder_list')return {...reminderStatus(),items:getSettings().reminders.filter(row=>args.include_completed||row.status==='scheduled'||row.status==='pending')};
  if(name==='alarm_stop'){stopped=true;stopAlarmSound();return {stopping:ringing};}
  if(name==='reminder_cancel'){
    const id=String(args.id??'');const job=getSettings().reminders.find(row=>row.id===id);
    if(!job)throw new Error('指定した予約が見つかりません');
    changeSettings(data=>{data.reminders=data.reminders.map(row=>row.id===id?{...row,status:'cancelled'}:row);});
    if(job.status==='pending'){stopped=true;stopAlarmSound();}
    return {cancelled:true,id};
  }
  if(!ready())throw new Error('本体の時刻が未同期です。Wi-FiかUSBで時刻を同期してください');
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
  changeSettings(data=>{data.reminders=compact(data.reminders);data.reminders.push(item);});
  trace('[tools] reminder scheduled\n');
  return item;
}
async function notify(item){
  ringing=true;stopped=false;
  try{
    try{robot.lightRainbow?.('head');}catch(_){trace('[tools] rainbow LED unavailable\n');}
    let visible=false;try{visible=alarmDisplay?.show(item)===true;}catch(_){trace('[tools] alarm screen unavailable\n');}if(!visible)robot.showBalloon(item.title);
    let custom=false;try{custom=await playAlarmSound(robot,()=>stopped);}catch(_){trace('[tools] custom sound unavailable; tone fallback\n');}
    if(!custom)for(let i=0;i<12&&!stopped;i++){
      await robot.audio.tone(i%2?660:880,180,Math.min(robot.audio.volume,0.45));
      await wait(180);
    }
    changeSettings(data=>{data.reminders=data.reminders.map(row=>row.id===item.id&&row.status==='pending'?finishReminder(row,Date.now()):row);});
    trace('[tools] reminder notification completed\n');
  }catch(_){trace('[tools] reminder notification failed; kept pending\n');}
  finally{try{robot.lightOff?.('head');}catch(_){}try{alarmDisplay?.close();}catch(_){}robot.hideBalloon();ringing=false;release();}
}
export function startDeviceTools(context,acquire,unlock){
  robot=context;claim=acquire;release=unlock;
  Timer.repeat(()=>{
    if(!ready())return;
    try{
      if(getSettings().reminders.some(row=>row.status==='scheduled'&&row.due<=Date.now())){
        changeSettings(data=>{data.reminders=data.reminders.map(row=>row.status==='scheduled'&&row.due<=Date.now()?(row.repeat==='daily'&&Date.now()-row.due>300000?{...row,due:nextDailyDue(Date.now(),row.hour,row.minute)}:{...row,status:'pending'}):row);});
      }
      const pending=getSettings().reminders.find(row=>row.status==='pending');
      if(pending&&!ringing&&claim())void notify(pending);
    }catch(_){trace('[tools] reminder storage unavailable\n');}
  },1000);
  robot.drawer.addDrawerButton({key:'alarmStop',label:'アラーム音を停止',callback:()=>{stopped=true;stopAlarmSound();}});
}
