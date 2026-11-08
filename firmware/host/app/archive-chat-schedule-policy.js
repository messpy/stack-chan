// Fixed UTC offsets match the firmware's timezone presets (DST is not modeled).
export const DEFAULT_AI_SCHEDULE = Object.freeze({enabled:false,onMinute:8*60,offMinute:23*60});
const validMinute = value => Number.isInteger(value)&&value>=0&&value<1440;
export function validAISchedule(value) {
 return !!value&&typeof value==='object'&&typeof value.enabled==='boolean'&&validMinute(value.onMinute)&&validMinute(value.offMinute)&&value.onMinute!==value.offMinute;
}
export function normalizeAISchedule(value) {
 return validAISchedule(value)?{enabled:value.enabled,onMinute:value.onMinute,offMinute:value.offMinute}:{...DEFAULT_AI_SCHEDULE};
}
export function scheduleBoundary(epoch,value,offsetMinutes=540) {
 const schedule=normalizeAISchedule(value);
 // Without a trustworthy RTC/NTP epoch, never change the microphone/chat mode.
 if(!schedule.enabled||!Number.isFinite(epoch)||epoch<1700000000000||epoch>=Date.UTC(2100,0,1))return null;
 if(!Number.isFinite(offsetMinutes)||offsetMinutes < -12*60||offsetMinutes > 14*60)return null;
 const offsetMs=offsetMinutes*60000;
 const local=new Date(epoch+offsetMs);
 const midnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-offsetMs;
 let latest=null;
 for(const day of [-1,0]) {
  for(const [minute,enabled] of [[schedule.onMinute,true],[schedule.offMinute,false]]) {
   const at=midnight+day*86400000+minute*60000;
   if(at<=epoch&&(!latest||at>latest.at))latest={at,enabled};
  }
 }
 return latest;
}
