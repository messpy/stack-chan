import Worker from 'worker';
import Timer from 'timer';
let diagnostics={phase:'idle'};
export function workerTextDiagnostics(){return {...diagnostics};}
function request(message,timeoutMs){return new Promise((resolve,reject)=>{
 let worker,timer,finished=false;
 const finish=(error,value)=>{if(finished)return;finished=true;if(timer!==undefined)Timer.clear(timer);Timer.set(()=>{try{worker?.terminate();}catch(_){}worker=undefined;},0);error?reject(error):resolve(value);};
 try{
  diagnostics={phase:'starting'};
  worker=new Worker('archive-text-network-worker',{static:1024*1024,chunk:{initial:128*1024,incremental:16384},heap:{initial:2048,incremental:256},stack:1024,nativeStack:24*1024,priority:3});
  worker.onmessage=data=>{
   if(data.kind==='status'){diagnostics=data.transport||{phase:'working'};return;}
   diagnostics=data.transport||{phase:data.error?'failed':'completed'};
   finish(data.error?new Error(data.error):null,data.text);
  };
  timer=Timer.set(()=>finish(new Error('AIへの通信がタイムアウトしました')),timeoutMs+5000);
  worker.postMessage(message);
 }catch(e){finish(e);}
});}
export function workerPostVision(host,path,headers,body,method='POST',timeoutMs=60000){
 if(!['generativelanguage.googleapis.com','ollama.com'].includes(host))throw new Error('Unsupported text provider');
 return request({kind:'http',host,path,headers,body,method,timeoutMs},timeoutMs);
}
export function workerXiaoZhiText(text,configuration){return request({kind:'xiaozhi',text,configuration},45000);}
