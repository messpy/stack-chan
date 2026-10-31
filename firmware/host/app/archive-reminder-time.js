export function nextDailyDue(now,hour,minute){
 if(!Number.isFinite(now)||!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59)throw new Error('Invalid alarm time');
 const d=new Date(now+9*3600000),day=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-9*3600000;
 const due=day+hour*3600000+minute*60000;return due>now?due:due+86400000;
}
export function japaneseClock(epoch){const d=new Date(epoch+9*3600000);return {hour:d.getUTCHours(),minute:d.getUTCMinutes()};}
export function finishReminder(row,now){return row.repeat==='daily'?{...row,status:'scheduled',due:nextDailyDue(now,row.hour,row.minute),fired:now}:{...row,status:'fired',fired:now};}
