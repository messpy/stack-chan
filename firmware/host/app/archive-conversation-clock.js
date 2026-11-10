// Generates an explicit local timestamp for every conversational request.
const validEpoch=value=>Number.isFinite(value)&&value>=1700000000000&&value<Date.UTC(2100,0,1);
const two=value=>String(value).padStart(2,'0');
export function conversationClockContext(epoch,offsetMinutes) {
 if(!validEpoch(epoch))return {valid:false,reason:'device clock not initialized'};
 if(!Number.isInteger(offsetMinutes)||offsetMinutes < -12*60||offsetMinutes > 14*60)return {valid:false,reason:'timezone unavailable'};
 const date=new Date(epoch+offsetMinutes*60000);
 const offset=(offsetMinutes<0?'-':'+')+two(Math.floor(Math.abs(offsetMinutes)/60))+':'+two(Math.abs(offsetMinutes)%60);
 const localTime=date.getUTCFullYear()+'-'+two(date.getUTCMonth()+1)+'-'+two(date.getUTCDate())+'T'+two(date.getUTCHours())+':'+two(date.getUTCMinutes())+':'+two(date.getUTCSeconds())+offset;
 const hour=date.getUTCHours();
 return {
  valid:true,localTime,
  timezone:offsetMinutes===540?'Asia/Tokyo':'UTC'+offset,
  period:hour<5?'深夜':hour<11?'朝':hour<17?'昼':hour<22?'夜':'深夜',
  source:'device-clock; NTP synchronization not independently verified'
 };
}
export function conversationClockInstruction(epoch,offsetMinutes) {
 const clock=conversationClockContext(epoch,offsetMinutes);
 if(!clock.valid)return '現在日時と時間帯は未確認です。朝・昼・夜などの挨拶を決めつけず、必要なら時計の設定を案内してください。';
 return '会話生成時点の端末現地時刻: '+JSON.stringify(clock)+'。UTCと混同せずこの現地時刻を使って挨拶してください。日時は端末時計に由来し同期精度は未保証です。';
}
