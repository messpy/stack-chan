import Resource from 'Resource';
import Timer from 'timer';
import AudioIn from 'embedded:io/audio/in';
import {start as inferStart,poll as inferPoll} from 'archive-koeact-native';
import {collectMemory,prepareRecognitionPCM} from 'archive-usb';
import {decodeKoeActActions} from 'archive-voice-command-policy';
import {getVolume,setVolume} from 'archive-volume';
import {moveHead} from 'archive-head-motion';
import {Emotion} from 'face-state';
const COLORS={red:[96,0,0],orange:[96,40,0],yellow:[96,80,0],green:[0,96,0],light_blue:[0,64,96],blue:[0,0,96],purple:[55,0,96],pink:[96,20,50],white:[96,96,96]};
export function createKoeAct({robot,claim,release,pause,resume,canAct}){
 let state='idle',error='',last=null,cancelled=false;
 const status=()=>({available:true,koeactOfflineReady:last!==null,state,error,last,threshold:.97,mode:'push-to-talk',seconds:4,supported:['volume','look','expression','led']});
 return {status,cancel(){cancelled=true;return status();},start(args={}){
  if(args.dryRun!==undefined&&typeof args.dryRun!=='boolean')throw new Error('Invalid voice test option');const dryRun=args.dryRun===true;
  if(state==='recording'||state==='thinking'||state==='acting')throw new Error('音声操作を処理中です');
  const paused=pause();if(!claim()){if(paused)resume();throw new Error('本体で処理中です');}
  state='recording';error='';cancelled=false;
  Promise.resolve().then(async()=>{
   let input,unlock,timeout,poll;const pcm=new Uint8Array(128000);let offset=0;
   try{
    unlock=robot.audio.acquireExclusive();
    await new Promise((resolve,reject)=>{
     let done=false;
     const finish=e=>{if(done)return;done=true;Timer.set(()=>{try{input?.close();input=undefined;}catch(_){}e?reject(e):resolve();},0);};
     timeout=Timer.set(()=>finish(new Error('録音できませんでした')),6000);
     poll=Timer.repeat(()=>{if(cancelled||!canAct())finish(new Error('音声操作を中止しました'));},100);
     input=new AudioIn({sampleRate:16000,channels:2,onReadable(){try{const raw=input.read();if(!raw?.byteLength)return;const part=new Uint8Array(prepareRecognitionPCM(raw,0,raw.byteLength,input.channels).buffer);const count=Math.min(part.length,pcm.length-offset);pcm.set(part.subarray(0,count),offset);offset+=count;if(offset===pcm.length)finish();}catch(e){finish(e);}}});
     input.start();
    });
    Timer.clear(timeout);timeout=undefined;Timer.clear(poll);poll=undefined;
    if(cancelled||!canAct())throw new Error('音声操作を中止しました');
    state='thinking';
    collectMemory();inferStart(pcm.buffer);
    const result=await new Promise((resolve,reject)=>{const timer=Timer.repeat(()=>{try{const value=inferPoll();if(value){Timer.clear(timer);resolve(value);}}catch(e){Timer.clear(timer);reject(e);}},100);});
    const pieces=JSON.parse(String.fromArrayBuffer(new Resource('pieces.json')));let json='';
    for(const id of result.ids){if(!Number.isInteger(id)||id<0||id>=pieces.length)throw new Error('認識結果が不正です');if(id===59)break;if(id!==60&&id!==61)json+=pieces[id];}
    const actions=decodeKoeActActions({pAct:result.pAct,actions:JSON.parse(json)});
    last={pAct:result.pAct,elapsedMs:result.elapsedMs,accepted:!!actions,dryRun,actions:actions||[],count:actions?.length||0,memory:{stackFree:result.stackFree,internalBefore:result.internalBefore,internalAfter:result.internalAfter,psramBefore:result.psramBefore,psramAfter:result.psramAfter}};
    if(!actions){state='rejected';robot.showBalloon('対応する操作として認識できませんでした');return;}
    if(cancelled||!canAct())throw new Error('音声操作を中止しました');
    if(dryRun){state='checked';return;}
    state='acting';
    for(const action of actions){
     if(cancelled||!canAct())throw new Error('音声操作を中止しました');
     if(action.type==='volume')setVolume(action.value);
     else if(action.type==='volume_delta')setVolume(Math.max(0,Math.min(100,getVolume().percent+action.value)));
     else if(action.type==='look')await moveHead(robot,{direction:action.value});
     else if(action.type==='expression')robot.setEmotion(Emotion[action.value.toUpperCase()]||Emotion.NEUTRAL);
     else if(action.type==='led')for(const name of Object.keys(robot.led)){if(action.value==='off')robot.lightOff(name);else robot.lightOn(name,...COLORS[action.value]);}
    }
    state='completed';robot.showBalloon('オフライン音声操作を実行しました');
   }catch(e){state=cancelled?'cancelled':'failed';error=cancelled?'中止しました':/memory/.test(String(e.message))?'メモリが不足しています。AI会話や他の処理を停止して再試行してください':'音声操作に失敗しました。もう一度お試しください';}
   finally{if(timeout!==undefined)Timer.clear(timeout);if(poll!==undefined)Timer.clear(poll);try{input?.close();}catch(_){}unlock?.();release();if(paused)resume();}
  });
  return status();
 }};
}
