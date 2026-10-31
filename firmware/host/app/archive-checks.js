import Timer from 'timer';
import {Container,Label,Text as CheckText,Skin,Style} from 'piu/MC';
import {uiFont} from 'ui-theme';
import {ActionButton} from 'ui-controls';
const entries=[['emotion','表情'],['servo','サーボ'],['led','LED'],['recognition','音声認識'],['audio','音声']];
export function createCheckRunner(actions){
  let running=false,cancelled=false,step='',message='',results=[];
  const status=()=>({running,step,message,results:results.map(x=>({...x}))});
  return {status,stop(){cancelled=true;},async run(kind,notify=()=>{}){
    if(running)throw new Error('動作確認中です');
    const list=kind==='all'?entries:entries.filter(([id])=>id===kind);
    if(!list.length)throw new Error('確認項目を選んでください');
    actions.prepare();running=true;cancelled=false;results=[];
    try{
      for(const [id,title] of list){
        if(cancelled)break;
        step=id;message=title+'を確認中';notify(status());trace('[checks] '+id+' begin\n');
        try{const detail=await actions.test(id,text=>{message=text;notify(status());},()=>cancelled);results.push({id,title,state:cancelled?'stopped':'done',detail:detail||'実行完了・実物を確認してください'});}
        catch(error){results.push({id,title,state:cancelled?'stopped':'failed',detail:cancelled?'途中で停止しました':error?.message==='network'?'Wi-Fi接続とAI設定が必要です':error?.message==='speech-timeout'?'聞き取れませんでした。もう一度、短く話してください。':'実行できませんでした。情報取得・ログを確認してください。'});trace('[checks] '+id+' failed\n');}
        trace('[checks] '+id+' end\n');notify(status());
      }
    }finally{running=false;step='';message=cancelled?'停止しました':'確認が終わりました';notify(status());}
    return status();
  }};
}
let runner,progressBar;
export function checkStatus(){return runner?.status()||{running:false};}
export function startChecks(robot,actions){
  runner=createCheckRunner(actions);
  const launch=()=>robot.ui.application.behavior.launchMiniApp('archive-checks');
  robot.ui.miniApps.register({id:'archive-checks',title:'動作確認',hidden:true,create(context){
    const root=new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'})});
    const title=new Label(null,{left:8,right:8,top:0,height:26,style:new Style({font:uiFont(),color:'black'}),string:'動作確認'});root.add(title);
    function begin(id){
      if(runner.status().running)return;
      try{actions.prepare();}catch(_){title.string='本体が使用中です。後で試してください';return;}
      context.close();
      Timer.set(()=>{
      robot.ui.showFace();robot.hideBalloon();
      if(progressBar)robot.ui.removeEffect(progressBar);
      const bar=new Container(null,{left:0,right:0,bottom:0,height:74,skin:new Skin({fill:'#ffffff'})});
      const label=new Label(null,{left:4,right:4,top:0,height:30,style:new Style({font:uiFont(),color:'black'}),string:''});
      bar.add(label);bar.add(new ActionButton({label:'停止',onTap:()=>runner.stop()},{left:4,top:34,width:148,height:36}));
      bar.add(new ActionButton({label:'結果 / 戻る',onTap:()=>{if(runner.status().running)runner.stop();robot.ui.removeEffect(bar);progressBar=undefined;launch();}},{right:4,top:34,width:156,height:36}));
      progressBar=bar;robot.ui.addEffect(bar,'archive-check-progress');
      void runner.run(id,s=>{label.string=s.message;}).catch(()=>{label.string='開始できませんでした';});
      },0);
    }
    for(const [i,[id,label]] of [...entries,['all','まとめて確認']].entries())root.add(new ActionButton({label,onTap:()=>begin(id)},{left:i%2?164:8,top:30+Math.floor(i/2)*40,width:148,height:34}));
    root.add(new ActionButton({label:'前回の結果',onTap:()=>robot.ui.application.behavior.launchMiniApp('archive-check-results')},{left:8,top:154,width:148,height:32}));
    root.add(new ActionButton({label:'設定へ',onTap:()=>robot.ui.application.behavior.launchMiniApp('archive-settings')},{right:8,top:154,width:148,height:32}));
    return {content:root};
  }});
  robot.ui.miniApps.register({id:'archive-check-results',title:'確認結果',hidden:true,create(){
    let index=0;const results=runner.status().results;
    const label=new Label(null,{left:8,right:8,top:0,height:40,style:new Style({font:uiFont(),color:'black'}),string:''});
    const body=new CheckText(null,{left:10,right:10,top:42,height:90,style:new Style({font:uiFont(),color:'black',horizontal:'left',vertical:'top'}),string:''});
    const update=()=>{const item=results[index];label.string=item?item.title+' '+(index+1)+'/'+results.length:'まだ確認していません';body.string=item?(item.state==='failed'?'確認できず':item.state==='stopped'?'停止':'実行完了')+'\n'+item.detail:'';};update();
    return {content:new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'}),contents:[label,body,
      new ActionButton({label:'次の結果',onTap:()=>{index=results.length?(index+1)%results.length:0;update();}},{left:8,top:142,width:148,height:36}),
      new ActionButton({label:'戻る',onTap:launch},{right:8,top:142,width:148,height:36})]})};
  }});
}
