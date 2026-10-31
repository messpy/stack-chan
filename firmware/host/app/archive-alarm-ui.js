import {Container,Label,Text,Skin,Style,Behavior} from 'piu/MC';
import {uiFont} from 'ui-theme';
import {getSettings} from 'archive-vault';
import {nextDailyDue,japaneseClock} from 'archive-reminder-time';
let robot,actions,hour=7,minute=0,daily=true,index=0,ringItem,ringClose;
const pad=n=>('0'+n).slice(-2),clock=()=>pad(hour)+':'+pad(minute);
const body=new Style({font:uiFont(),color:'black',horizontal:'center',vertical:'middle'});
const buttonStyle=new Style({font:uiFont(),color:'white',horizontal:'center',vertical:'middle'});
const buttonSkin=new Skin({fill:['#236a5a','#174e42']});
class Tap extends Behavior{onCreate(label,data){this.action=data.onTap;}onTouchBegan(label,id,x,y,ticks){label.state=1;label.captureTouch(id,x,y,ticks);}onTouchEnded(label){label.state=0;this.action();}onTouchCancelled(label){label.state=0;}}
function button(label,onTap,geometry){return new Label({onTap},{...geometry,active:true,skin:buttonSkin,style:buttonStyle,string:label,Behavior:Tap});}
export function showRingingAlarm(item){ringItem=item;robot.hideBalloon();robot.ui.application.behavior.closeDrawer?.();return robot.ui.application.behavior.launchMiniApp('archive-alarm-ringing');}
export function hideRingingAlarm(){const close=ringClose;ringClose=undefined;close?.();}
export function openAlarmSettings(){robot.ui.application.behavior.closeDrawer?.();robot.ui.application.behavior.launchMiniApp('archive-alarm');return {opened:true};}
export function startAlarmSettings(context,callbacks){
 robot=context;actions=callbacks;
 robot.ui.miniApps.register({id:'archive-alarm-ringing',hidden:true,title:'アラーム',create(context){
  ringClose=context.close;
  const stop=button('停止',()=>{stop.string='停止中';actions.stop();},{left:12,right:12,top:78,bottom:14});
  stop.skin=new Skin({fill:['#c12d3c','#8e1d29']});stop.style=new Style({font:'k8x12-24',color:'white',horizontal:'center',vertical:'middle'});
  return {content:new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'#fff4e6'}),contents:[new Text(null,{left:12,right:12,top:8,height:60,style:body,string:((ringItem?.kind==='timer')?'タイマー終了':'アラーム')+'\n'+String(ringItem?.title||'') .slice(0,60)}),stop]}),dispose(){if(ringClose){ringClose=undefined;actions.stop();}}};
 }});
 robot.ui.miniApps.register({id:'archive-alarm',hidden:true,title:'アラーム設定',create(){
  const last=getSettings().reminders.filter(r=>r.kind==='alarm').slice(-1)[0];if(last){const t=japaneseClock(last.due);hour=t.hour;minute=t.minute;daily=last.repeat==='daily';}
  const value=new Label(null,{left:0,right:0,top:0,height:32,style:new Style({font:'k8x12-24',color:'black',horizontal:'center'}),string:clock()});
  const status=new Text(null,{left:8,right:8,top:156,height:32,style:body,string:'時刻を選んで「登録」を押してください'});
  const change=(h,m)=>{hour=(hour+h+24)%24;minute=(minute+m+60)%60;value.string=clock();};
  const repeat=button(daily?'繰り返し: 毎日':'繰り返し: 1回',()=>{daily=!daily;repeat.string=daily?'繰り返し: 毎日':'繰り返し: 1回';},{left:10,right:10,top:76,height:34});
  const save=()=>{try{const due=nextDailyDue(Date.now(),hour,minute);actions.create({when:new Date(due).toISOString(),repeat:daily?'daily':'once',title:daily?'毎日のアラーム':'アラーム'});status.string=clock()+(daily?' 毎日':' 1回')+'で保存しました';}catch(e){status.string=Date.now()<1700000000000?'オフラインの時計設定で時刻を合わせてください':String(e.message||'保存できませんでした');}};
  return {content:new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'}),contents:[value,
   button('時 −',()=>change(-1,0),{left:10,top:36,width:68,height:34}),button('時 ＋',()=>change(1,0),{left:87,top:36,width:68,height:34}),button('分 −',()=>change(0,-1),{right:87,top:36,width:68,height:34}),button('分 ＋',()=>change(0,1),{right:10,top:36,width:68,height:34}),repeat,
   button('登録',save,{left:10,top:116,width:145,height:34}),button('予約一覧',()=>robot.ui.application.behavior.launchMiniApp('archive-alarm-list'),{right:10,top:116,width:145,height:34}),status]})};
 }});
 robot.ui.miniApps.register({id:'archive-alarm-list',hidden:true,title:'アラーム・タイマー',create(){
  const summary=new Text(null,{left:8,right:8,top:4,height:62,style:body,string:''});let rows=[];
  const render=()=>{rows=actions.list().items;index=Math.max(0,Math.min(index,rows.length-1));const row=rows[index];if(!row){summary.string='予約はありません';return;}const t=japaneseClock(row.due);if(row.kind==='timer'&&row.remainingMs!==undefined){summary.string=(index+1)+' / '+rows.length+'  残り '+Math.ceil(row.remainingMs/1000)+'秒\n'+row.title;return;}summary.string=(index+1)+' / '+rows.length+'  '+pad(t.hour)+':'+pad(t.minute)+(row.repeat==='daily'?' 毎日':' 1回')+'\n'+row.title;};
  const cancel=()=>{try{if(rows[index])actions.cancel(rows[index].id);render();}catch(_){summary.string='解除できませんでした';}};render();
  return {content:new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'}),contents:[summary,button('この予約を解除',cancel,{left:10,right:10,top:72,height:38}),button('前へ',()=>{index--;render();},{left:10,top:116,width:92,height:36}),button('次へ',()=>{index++;render();},{left:114,top:116,width:92,height:36}),button('設定',()=>openAlarmSettings(),{right:10,top:116,width:92,height:36})]})};
 }});
 robot.drawer.addDrawerButton({key:'alarmSettings',label:'アラーム設定',callback:openAlarmSettings});
}
