// TLS runs in its own VM, leaving the device HTTP server and Piu responsive.
import Timer from 'timer';
import {postVision,visionHTTPStatus} from 'archive-vision-http';
import {xiaozhiTextChat,xiaozhiTextDiagnostics} from 'archive-xiaozhi-vision';
let busy=false;
self.onmessage=async message=>{
 if(busy)return;busy=true;
 const status=()=>message.kind==='xiaozhi'?xiaozhiTextDiagnostics():visionHTTPStatus()||{phase:'connecting'};
 const timer=Timer.repeat(()=>self.postMessage({kind:'status',transport:status()}),1000);
 try{
  let text;
  if(message.kind==='xiaozhi')text=await xiaozhiTextChat(message.text,message.configuration);
  else if(message.kind==='http'&&['generativelanguage.googleapis.com','ollama.com'].includes(message.host))text=await postVision(message.host,message.path,message.headers,message.body,message.method,message.timeoutMs);
  else throw new Error('Unsupported text transport');
  self.postMessage({kind:'result',text,transport:status()});
 }catch(e){self.postMessage({kind:'result',error:String(e.message||'AI communication failed'),transport:status()});}
 finally{Timer.clear(timer);busy=false;}
};
