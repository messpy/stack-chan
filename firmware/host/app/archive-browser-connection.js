// Browser-side RPC transport. Keep requests bounded and avoid overlapping work on CoreS3.
export default `let rpcQueue=Promise.resolve();
function rpc(op,args){
 const run=async()=>{
  const controller=new AbortController();
  const slow=['/chat/text','/chat/text/status','/alarm-sound/discover','/photo','/record','/audio','/chat/test','/monitor/speak','/image/finish','/alarm-sound/preview'].includes(op);
  const timer=setTimeout(()=>controller.abort(),op==='/chat/text/status'?20000:slow?60000:10000);
  try{
   const response=await fetch('/rpc',{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({op:op,args:args||{}})});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'本体で処理できませんでした');
   return result;
  }catch(error){
   if(error.name==='AbortError'||error instanceof TypeError){const failure=Error('本体の応答がありません。再接続を押してください。');failure.networkFailure=true;throw failure;}
   throw error;
  }finally{clearTimeout(timer);}
 };
 const execute=async()=>{for(let attempt=0;;attempt++){try{return await run();}catch(error){if(op!=='/chat/text/status'||!error.networkFailure||attempt>=2)throw error;}}};
 const pending=rpcQueue.then(execute,execute);
 rpcQueue=pending.catch(()=>{});
 return pending;
}`;
