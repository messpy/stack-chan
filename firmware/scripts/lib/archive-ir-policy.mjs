// Host-only validation prototype. No GPIO/RMT/SD/network/audio side effects.
const slug=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(value);
const whole=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const protocols=new Set(['NEC','RAW']);
const deviceTypes=new Set(['tv','aircon','lighting','av']);

export function validateLearnedIR(record){
 if(!record||typeof record!=='object'||Array.isArray(record))return {ok:false,reason:'not-object'};
 const keys=['version','deviceId','buttonId','deviceType','protocol','address','command','carrierHz','timingsUs','repeat'];
 if(Object.keys(record).some(key=>!keys.includes(key)))return {ok:false,reason:'unknown-field'};
 if(record.version!==1||!slug(record.deviceId)||!slug(record.buttonId)||!deviceTypes.has(record.deviceType))return {ok:false,reason:'invalid-identity'};
 if(!protocols.has(record.protocol)||!whole(record.repeat,0,3)||!whole(record.carrierHz,36000,40000))return {ok:false,reason:'invalid-carrier-or-protocol'};
 if(record.protocol==='NEC'){
  if(!whole(record.address,0,65535)||!whole(record.command,0,65535)||record.timingsUs!==undefined)return {ok:false,reason:'invalid-nec'};
 }else{
  if(record.address!==undefined||record.command!==undefined)return {ok:false,reason:'unexpected-decoded-fields'};
  if(!Array.isArray(record.timingsUs)||record.timingsUs.length<2||record.timingsUs.length>1024||record.timingsUs.length%2!==0)return {ok:false,reason:'invalid-raw-length'};
  if(!record.timingsUs.every(value=>whole(value,100,20000)))return {ok:false,reason:'invalid-raw-timing'};
  if(record.timingsUs.reduce((a,b)=>a+b,0)>1500000)return {ok:false,reason:'raw-duration-limit'};
 }
 return {ok:true,reason:null};
}

export function resolveStrictVoiceIRCommand(transcript,registered){
 // Only confirmed full-string matches in locally configured phrases may transmit.
 if(typeof transcript!=='string'||transcript.length>80||!Array.isArray(registered)||registered.length>64)return null;
 const normalized=transcript.trim().replace(/[。．！？!?]+$/u,'');
 if(!normalized||/[\r\n]/.test(normalized))return null;
 const matches=registered.filter(entry=>
  validateLearnedIR(entry.record).ok &&
  Array.isArray(entry.phrases)&&entry.phrases.length<=8&&
  entry.phrases.some(phrase=>typeof phrase==='string'&&phrase===normalized));
 return matches.length===1?{deviceId:matches[0].record.deviceId,buttonId:matches[0].record.buttonId}:null;
}

export function canSendIR(learnedRecord,now,lastSentAt,minIntervalMs=500){
 if(!validateLearnedIR(learnedRecord).ok)return false;
 if(!Number.isFinite(now)||!whole(minIntervalMs,0,10000))return false;
 return lastSentAt===null||Number.isFinite(lastSentAt)&&now>=lastSentAt+minIntervalMs;
}
