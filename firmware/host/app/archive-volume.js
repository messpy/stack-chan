import {Container,Label,Skin,Style} from 'piu/MC';
import {ActionButton} from 'ui-controls';
import {uiStyles} from 'ui-theme';
let robot;
let preview=Promise.resolve();
function previewVolume(){
  const volume=robot.audio.volume;
  if(!volume)return;
  preview=preview.then(()=>robot.audio.tone(880,100,volume)).catch(()=>trace('[volume] preview unavailable\n'));
}
export function getVolume(){return {percent:Math.round(robot.audio.volume*100)};}
export function setVolume(percent,playPreview=false){
  if(!Number.isInteger(percent)||percent<0||percent>100)throw new Error('Volume must be 0..100');
  const previous=getVolume().percent;
  robot.audio.volume=percent/100;
  trace('[volume] changed from='+previous+' to='+getVolume().percent+'\n');
  if(playPreview)previewVolume();
  return getVolume();
}
export function openVolume(){
  robot.ui.application.behavior.closeDrawer?.();
  if(!robot.ui.application.behavior.launchMiniApp('archive-volume'))throw new Error('Volume screen unavailable');
  previewVolume();
  return getVolume();
}
export function startVolume(context){
  robot=context;
  robot.ui.miniApps.register({id:'archive-volume',hidden:true,title:'音量',create(){
    const styles=uiStyles();
    const value=new Label(null,{left:0,right:0,top:10,height:38,style:new Style({font:'k8x12-24',color:'black',horizontal:'center'}),string:getVolume().percent+'%'});
    const change=percent=>{setVolume(Math.max(0,Math.min(100,percent)));value.string=getVolume().percent+'%';previewVolume();};
    return {content:new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'}),contents:[value,
      new ActionButton({label:'−10%',onTap:()=>change(getVolume().percent-10)},{left:16,top:60,width:136,height:48}),
      new ActionButton({label:'＋10%',onTap:()=>change(getVolume().percent+10)},{right:16,top:60,width:136,height:48}),
      new ActionButton({label:'消音',onTap:()=>change(0)},{left:16,right:16,top:120,height:48})
    ]})};
  }});
  robot.drawer.addDrawerButton({key:'archiveVolume',label:'音量',callback:openVolume});
}
