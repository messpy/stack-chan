export function grayscale565(buffer,width,height){
 if(width!==176||height!==144||buffer.byteLength!==width*height*2)throw new Error('Invalid camera frame');
 const view=new DataView(buffer),out=new Uint8Array(44*36);
 for(let y=0;y<36;y++)for(let x=0;x<44;x++){
  let sum=0;
  for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++){const p=view.getUint16(((y*4+dy)*width+x*4+dx)*2,true);sum+=((p>>11)*255/31)*.299+(((p>>5)&63)*255/63)*.587+((p&31)*255/31)*.114;}
  out[y*44+x]=Math.round(sum/16);
 }
 return out;
}
export function imageDifference(before,after,{sensitivity='medium',roi='all'}={}){
 if(before.length!==1584||after.length!==1584||!['low','medium','high'].includes(sensitivity)||!['all','center'].includes(roi))throw new Error('Invalid difference input');
 let offset=0,n=0;
 const inside=(x,y)=>roi==='all'||(x>=11&&x<33&&y>=9&&y<27);
 for(let y=0;y<36;y++)for(let x=0;x<44;x++)if(inside(x,y)){offset+=after[y*44+x]-before[y*44+x];n++;}
 offset/=n;let changed=0;const threshold={low:36,medium:24,high:14}[sensitivity];
 for(let y=0;y<36;y++)for(let x=0;x<44;x++)if(inside(x,y)&&Math.abs(after[y*44+x]-before[y*44+x]-offset)>=threshold)changed++;
 return {ratio:changed/n,offset};
}
export function createCameraWatch({capture,available,pose,notify,read=()=>({}),save=()=>{},now=()=>Date.now()}){
 let enabled=false,working=false,baseline,lastPose,lastCapture=0,consecutive=0,lastNotice=-Infinity,events=[],error='',ratio=0,skipped=0,revision=0;
 let settings={interval:60,sensitivity:'medium',roi:'all',...read()};
 const status=()=>({enabled,working,...settings,lastCapture,ratio,skipped,error,events:events.slice()});
 const clear=()=>{baseline=undefined;lastPose=undefined;consecutive=0;};
 const append=event=>{events.unshift(event);events=events.slice(0,30);};
 return {status,configure(value){
  const next={interval:value.interval??settings.interval,sensitivity:value.sensitivity??settings.sensitivity,roi:value.roi??settings.roi};
  if(![30,60,300].includes(next.interval)||!['low','medium','high'].includes(next.sensitivity)||!['all','center'].includes(next.roi)||value.enabled!==undefined&&typeof value.enabled!=='boolean')throw new Error('監視設定を確認してください');
  save(next);settings=next;revision++;clear();if(value.enabled!==undefined)enabled=value.enabled;lastCapture=0;return status();
 },stop(){enabled=false;revision++;clear();return status();},async test(){await notify({test:true,at:now()});return status();},async tick(){
  if(!enabled||working||now()-lastCapture<settings.interval*1000)return;
  if(!available()){skipped++;return;}
  working=true;const ticket=revision;lastCapture=now();
  try{
   const beforePose=pose(),current=await capture(),afterPose=pose();
   if(!enabled||ticket!==revision)return;
   const moved=(a,b)=>!a||!b||Math.abs(a.y-b.y)>.025||Math.abs(a.p-b.p)>.025;
   if(moved(beforePose,afterPose)||moved(lastPose,afterPose)){baseline=current;lastPose=afterPose;consecutive=0;return;}
   const diff=baseline?imageDifference(baseline,current,settings):{ratio:0};baseline=current;lastPose=afterPose;ratio=diff.ratio;error='';
   consecutive=ratio>=.04?consecutive+1:0;
   if(consecutive>=2&&now()-lastNotice>=300000){lastNotice=now();const event={at:now(),ratio};append(event);await notify(event);}
  }catch(_){error='撮影・通知に失敗しました。次回に再試行します';clear();}
  finally{working=false;}
 }};
}
