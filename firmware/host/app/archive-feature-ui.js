import Timer from 'timer';
import {Container,Label,Skin,Style} from 'piu/MC';
import {ActionButton} from 'ui-controls';
import {uiFont} from 'ui-theme';
export function startFeatureUI(robot,{schedule,watch,ir,koeact}){
 const page=()=>new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'})});
 const label=(root,top,height=24)=>{const row=new Label(null,{left:8,right:8,top,height,string:'',style:new Style({font:uiFont(),color:'black',horizontal:'center'})});root.add(row);return row;};
 const button=(root,text,fn,box)=>root.add(new ActionButton({label:text,onTap:()=>{try{fn();}catch(e){robot.showBalloon(String(e.message));}}},box));
 robot.ui.miniApps.register({id:'archive-koeact',title:'オフライン音声操作',create(){
  const root=page(),note=label(root,6),help=label(root,38),detail=label(root,162);
  const render=()=>{const s=koeact.status();note.string=({idle:'ボタンを押して話してください',recording:'4秒間聞いています…',thinking:'本体で認識しています…',acting:'操作しています…',completed:'操作しました',rejected:'対応する命令として認識できませんでした',failed:'認識できませんでした',cancelled:'中止しました'}[s.state]);detail.string=s.error||'音声は外部へ送信しません';};
  help.string='音量・上下左右・表情・LED';
  button(root,'4秒間聞き取る',()=>{koeact.start();render();},{left:8,right:8,top:76,height:36});
  button(root,'中止',()=>{koeact.cancel();render();},{left:8,right:8,top:118,height:32});
  render();const timer=Timer.repeat(render,250);return {content:root,dispose(){Timer.clear(timer);}};
 }});
 robot.ui.miniApps.register({id:'archive-ir',title:'赤外線リモコン',create(){
  const root=page(),note=label(root,0),detail=label(root,27),item=label(root,58);let selected=0;
  const render=()=>{const s=ir.status();note.string=s.configured?'赤外線リモコン':'外付けIRの接続設定が必要です';detail.string=s.learning?'受信待ち（10秒）':s.error||'設定・登録はスマホ操作から';const rows=s.commands;selected=rows.length?selected%rows.length:0;item.string=rows[selected]?.label||'登録なし';};
  button(root,'次のボタン',()=>{selected++;render();},{left:8,right:8,top:91,height:30});
  button(root,'試送信',()=>{const s=ir.status();ir.send(s.commands[selected]?.id);render();},{left:8,right:8,top:126,height:30});
  button(root,'スマホで設定',()=>robot.ui.application.behavior.launchMiniApp('archive-control'),{left:8,right:8,top:162,height:30});
  render();const timer=Timer.repeat(render,500);return {content:root,dispose(){Timer.clear(timer);}};
 }});
 robot.ui.miniApps.register({id:'archive-ai-schedule',title:'AIスケジュール',create(){
  const root=page(),note=label(root,0),on=label(root,31),off=label(root,91),help=label(root,174,18);
  const format=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  const render=()=>{const s=schedule.status();note.string='毎日 '+(s.enabled?'ON':'OFF')+'（日本時間）';on.string='AI開始 '+format(s.on);off.string='AI停止 '+format(s.off);help.string=s.error||(!s.clockReady?'時計を設定してください':'手動変更は次の予約時刻まで優先');};
  const edit=(key,delta)=>{const s=schedule.status();schedule.configure({enabled:s.enabled,on:s.on,off:s.off,[key]:(s[key]+delta+1440)%1440});render();};
  for(const [i,key] of ['on','off'].entries())for(const [j,[text,delta]]of [['−1時',-60],['−5分',-5],['＋5分',5],['＋1時',60]].entries())button(root,text,()=>edit(key,delta),{left:8+j*78,top:57+i*60,width:74,height:30});
  button(root,'有効／無効',()=>{const s=schedule.status();schedule.configure({enabled:!s.enabled,on:s.on,off:s.off});render();},{left:8,right:8,top:149,height:26});
  render();const timer=Timer.repeat(render,1000);return {content:root,dispose(){Timer.clear(timer);}};
 }});
 robot.ui.miniApps.register({id:'archive-camera-watch',title:'見守りカメラ',create(){
  const root=page(),note=label(root,0),detail=label(root,28),last=label(root,159),hint=label(root,181,16);
  const render=()=>{const s=watch.status();note.string=s.enabled?'見守り中（撮影あり）':'見守り停止中';detail.string=s.interval+'秒 / '+({low:'低',medium:'中',high:'高'}[s.sensitivity])+'感度 / 差分'+Math.round(s.ratio*100)+'%';last.string=s.events.length?'検知 '+s.events.length+'件':'まだ検知はありません';hint.string=s.error||'起動時は停止・会話中は撮影を見送り';};
  const change=value=>{watch.configure(value);render();};
  button(root,'開始／停止',()=>change({enabled:!watch.status().enabled}),{left:8,right:8,top:57,height:30});
  button(root,'間隔を変更',()=>{const s=watch.status(),values=[30,60,300];change({interval:values[(values.indexOf(s.interval)+1)%3]});},{left:8,top:92,width:148,height:30});
  button(root,'感度を変更',()=>{const s=watch.status(),values=['low','medium','high'];change({sensitivity:values[(values.indexOf(s.sensitivity)+1)%3]});},{right:8,top:92,width:148,height:30});
  button(root,'全体／中央',()=>change({roi:watch.status().roi==='all'?'center':'all'}),{left:8,top:127,width:148,height:30});
  button(root,'通知テスト',()=>{watch.test().catch(()=>robot.showBalloon('通知できませんでした'));},{right:8,top:127,width:148,height:30});
  render();const timer=Timer.repeat(render,1000);return {content:root,dispose(){Timer.clear(timer);}};
 }});
}
