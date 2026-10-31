import Timer from 'timer';
import {Container,Label,Skin,Style} from 'piu/MC';
import {ActionButton} from 'ui-controls';
import {uiFont} from 'ui-theme';
let seconds=180,jobId;
const pad=n=>String(n).padStart(2,'0');
const format=n=>pad(Math.floor(n/60))+':'+pad(n%60);
export function startTimerUI(robot,actions){
  robot.ui.miniApps.register({id:'archive-timer',title:'タイマー',create(){
    let saved=!!jobId;
    const value=new Label(null,{left:0,right:0,top:0,height:36,string:'',style:new Style({font:'k8x12-24',color:'black',horizontal:'center'})});
    const note=new Label(null,{left:8,right:8,top:34,height:14,string:'',style:new Style({font:uiFont(),color:'black',horizontal:'center'})});
    const refresh=()=>{
      const row=jobId?actions.status().items.find(r=>r.id===jobId):undefined;
      value.string=format(row?.remainingMs!==undefined?Math.max(0,Math.ceil(row.remainingMs/1000)):saved?0:seconds);
      note.string=!saved?'時間を選んで開始':row?.status==='scheduled'?'残り時間':row?.status==='pending'?'時間です':'終了・解除済み';
      start.content('label').string=saved?'設定済み':'開始';start.active=!saved;
    };
    const choose=n=>{seconds=Math.max(10,Math.min(7200,n));jobId=undefined;saved=false;refresh();};
    const save=()=>{
      if(saved)return;
      try{const row=actions.create({seconds,title:'本体タイマー'});jobId=row.id;saved=true;refresh();}
      catch(error){note.string=String(error.message||'設定できませんでした');}
    };
    const button=(label,onTap,geometry)=>new ActionButton({label,onTap},geometry);
    const start=button('開始',save,{left:8,right:8,top:118,height:34});
    const root=new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'}),contents:[value,note,
      ...[[10,'10秒'],[60,'1分'],[180,'3分'],[300,'5分']].map(([n,label],i)=>button(label,()=>choose(n),{left:8+i*78,top:50,width:70,height:30})),
      button('−1分',()=>choose(seconds-60),{left:8,top:80,width:148,height:32}),button('＋1分',()=>choose(seconds+60),{right:8,top:80,width:148,height:32}),start,
      button('予約一覧・解除',()=>robot.ui.application.behavior.launchMiniApp('archive-alarm-list'),{left:8,right:8,top:158,height:32})]});
    refresh();const timer=Timer.repeat(refresh,1000);return {content:root,dispose(){Timer.clear(timer);}};
  }});
}
