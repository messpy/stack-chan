import Timer from 'timer'
import Time from 'time'
import {Container,Text,Skin,Style} from 'piu/MC'
import {uiFont} from 'ui-theme'
import {createUIButton} from 'archive-ui-button'
import {getSettings,changeSettings} from 'archive-vault'
import {normalizeAISchedule,validAISchedule,scheduleBoundary} from 'archive-chat-schedule-policy'

const two=value=>String(value).padStart(2,'0')
const displayTime=minute=>two(Math.floor(minute/60))+':'+two(minute%60)
const adjust=(minute,by)=>((minute+by)%1440+1440)%1440
export function startAISchedule(robot,{status,mode}) {
 let lastBoundary='',lastError='';
 const offsetMinutes=()=>Number(Time.timezone)/60;
 const saved=()=>normalizeAISchedule(getSettings().aiSchedule);
 function tick() {
  try {
   const schedule=saved(),boundary=scheduleBoundary(Date.now(),schedule,offsetMinutes());
   if(!boundary){if(!schedule.enabled)lastBoundary='';return}
   const key=[schedule.onMinute,schedule.offMinute,offsetMinutes(),boundary.at,boundary.enabled].join(':');
   if(key===lastBoundary)return;
   // Consume this boundary even on failure: do not retry cloud/session setup every 15s.
   lastBoundary=key;
   if(status().enabled!==boundary.enabled)mode(boundary.enabled);
   lastError='';
   trace('[ai-schedule] boundary applied mode='+(boundary.enabled?'on':'off')+'\n');
  }catch(error){
   lastError=String(error?.message||'切替失敗').slice(0,100);
   trace('[ai-schedule] boundary not applied (mode/config unavailable)\n');
  }
 }
 robot.ui.miniApps.register({
  id:'archive-ai-schedule',title:'AI時刻設定',hidden:true,
  create(){
   const root=new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'})});
   const style=new Style({font:uiFont(),color:'black',horizontal:'left',vertical:'middle'});
   let draft=saved();
   const fail=error=>robot.showBalloon(String(error?.message||'時刻設定を確認してください'));
   const methods={
    toggle(){draft={...draft,enabled:!draft.enabled};render()},
    adjust(args){draft={...draft,[args.key]:adjust(draft[args.key],args.by)};render()},
    save(){
     if(!validAISchedule(draft))throw new Error('ONとOFFは異なる時刻を選んでください');
     changeSettings(data=>{data.aiSchedule={...draft}});
     lastBoundary='';
     tick();
     render();
    },
    back(){robot.ui.application.behavior.onMiniAppBack()}
   };
   function add(text,method,args,left,top,width,height,color='#596375'){
    root.add(createUIButton({text,method,args,background:color,textColor:'#ffffff'},methods,{left,top,width,height},fail))
   }
   function render(){
    root.empty();
    root.add(new Text(null,{left:8,right:8,top:0,height:29,style,string:'AI会話 自動ON/OFF（毎日）'}));
    add('スケジュール '+(draft.enabled?'ON':'OFF'),'toggle',undefined,8,31,304,30,draft.enabled?'#167647':'#596375');
    root.add(new Text(null,{left:8,right:8,top:64,height:23,style,string:'ON時刻 '+displayTime(draft.onMinute)}));
    for(const [index,label,by] of [[0,'時－',-60],[1,'時＋',60],[2,'分－',-1],[3,'分＋',1]])add(label,'adjust',{key:'onMinute',by},8+index*77,88,73,27);
    root.add(new Text(null,{left:8,right:8,top:117,height:23,style,string:'OFF時刻 '+displayTime(draft.offMinute)}));
    for(const [index,label,by] of [[0,'時－',-60],[1,'時＋',60],[2,'分－',-1],[3,'分＋',1]])add(label,'adjust',{key:'offMinute',by},8+index*77,141,73,27);
    add('保存','save',undefined,8,173,148,29,'#167647');
    add('戻る','back',undefined,164,173,148,29,'#2563eb');
    const clockReady=Date.now()>=1700000000000&&Date.now()<Date.UTC(2100,0,1);
    root.add(new Text(null,{left:8,right:8,top:205,height:31,style,string:lastError||(!clockReady?'時計未設定：自動切替停止':'手動操作は次の切替時刻まで優先')}));
   }
   render();
   return {content:root};
  }
 });
 Timer.set(tick,2500);
 Timer.repeat(tick,15000);
 return {status:()=>({...saved(),lastError})};
}
