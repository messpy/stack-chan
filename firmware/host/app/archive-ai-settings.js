import Timer from 'timer';
import {Container,Text,Skin,Style} from 'piu/MC';
import {uiFont} from 'ui-theme';
import {createUIButton} from 'archive-ui-button';
export function startAISettings(robot,actions){robot.ui.miniApps.register({id:'archive-ai-settings',title:'AI選択',hidden:true,create(){
 const root=new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'})}),style=new Style({font:uiFont(),color:'black',horizontal:'left',vertical:'middle'});let signature='';
 const fail=e=>robot.showBalloon(String(e.message||'AI設定を確認してください'));
 const methods={selectAI:args=>{actions.select(args);render();}};
 function render(){const s=actions.status(),next=s.provider+':'+s.geminiConfigured;if(next===signature)return;signature=next;root.empty();root.add(new Text(null,{left:10,right:10,top:2,height:40,style,string:'選択中: '+(s.provider==='gemini'?'Gemini':'XiaoZhi')+'\nGeminiキー: '+(s.geminiConfigured?'登録済み':'未登録')}));
 for(const [index,provider] of ['xiaozhi','gemini'].entries())root.add(createUIButton({text:(provider==='gemini'?'Gemini':'XiaoZhi')+(s.provider===provider?' ✓':''),background:s.provider===provider?'#167647':'#596375',textColor:'#ffffff',method:'selectAI',args:{provider}},methods,{left:10,right:10,top:48+index*44,height:38},fail));
 root.add(new Text(null,{left:10,right:10,top:140,bottom:4,style,string:'会話と画像認識の両方に反映します。\nAPIキーの入力は「Wi-Fi / API設定」から。'}));}
 render();const timer=Timer.repeat(render,2000);return {content:root,dispose(){Timer.clear(timer);}};
}});}
