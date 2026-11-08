// Serialize state-changing USB commands while keeping a read-only status lane.
// A native synchronous stall still blocks the JS VM: this is NOT an RTOS watchdog.
export function createUSBRpcPump({read,write,execute,authenticate,inspect,arm,now=Date.now,trace=()=>{},timeoutMs=25000}) {
  let pending,receiveWarned=false;
  const safeReply=(payload)=>{
    try{write(JSON.stringify(payload));return true;}
    catch(e){trace('[usb-rpc] reply failed '+String(e?.name||'Error').slice(0,40)+'\n');return false;}
  };
  const snapshot=()=>pending?{
    active:true,operation:pending.op,
    elapsedMs:Math.max(0,now()-pending.started),
    timedOut:pending.timedOut
  }:{active:false};
  const finish=(task,error,result)=>{
    if(pending!==task)return;
    if(!task.responded){
      safeReply(error?{id:task.id,error:String(error?.message||error||'Operation failed').slice(0,160)}:{id:task.id,result});
    }
    pending=undefined;
  };
  const tick=()=>{
    if(pending&&!pending.timedOut&&now()-pending.started>=timeoutMs){
      pending.timedOut=true;
      trace('[usb-rpc] operation overdue op='+pending.op+'\n');
      pending.responded=true;
      safeReply({id:pending.id,error:'Operation timed out; it may still be running. Retry only after status becomes idle.'});
      // Keep pending as a lock: a promise timeout does not cancel native I/O.
    }
    let raw;
    try{raw=read();receiveWarned=false;}
    catch(e){if(!receiveWarned){trace('[usb-rpc] receive failed '+String(e?.name||'Error').slice(0,40)+'\n');receiveWarned=true;}return;}
    if(!raw)return;
    let request;
    try{request=JSON.parse(raw);}catch(_){return;}
    if(!request||!Number.isInteger(request.id)||!authenticate(request))return;
    arm();
    // Return the same USB operation/RTC diagnostics whether idle or busy.
    // Avoid SD and other application work in this diagnostic lane.
    if(request.op==='/debug/status'){
      try{safeReply({id:request.id,result:inspect(request.op,snapshot())});}
      catch(_){safeReply({id:request.id,error:'Status unavailable'});}
      return;
    }
    if(pending){
      if(request.op==='/status'||request.op==='/debug/status'){
        let result;
        try{result=inspect(request.op,snapshot());}
        catch(e){safeReply({id:request.id,error:'Status unavailable'});return;}
        safeReply({id:request.id,result});
      }else safeReply({id:request.id,error:'Device busy with '+pending.op+'; poll /status'});
      return;
    }
    const task={id:request.id,op:String(request.op||''),started:now(),timedOut:false,responded:false};
    pending=task;
    try{
      // Both synchronous failures and async rejections must release the lock.
      Promise.resolve(execute(request)).then(
        result=>finish(task,null,result),
        error=>finish(task,error)
      );
    }catch(error){finish(task,error);}
  };
  return {tick,snapshot};
}
