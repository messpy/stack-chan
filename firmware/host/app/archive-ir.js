const validId=id=>typeof id==='string'&&/^[a-z0-9-]{1,32}$/.test(id);
export function validateIR(record){
 if(!record||!validId(record.id)||typeof record.label!=='string'||record.label.length<1||record.label.length>40||!Array.isArray(record.pulses)||record.pulses.length<3||record.pulses.length>512||record.pulses.some(n=>!Number.isInteger(n)||n<100||n>15000)||record.pulses.reduce((a,b)=>a+b,0)>250000||!Number.isInteger(record.carrier)||record.carrier<30000||record.carrier>56000)throw new Error('赤外線データが不正です');
 const phrase=record.phrase||'';
 if(typeof phrase!=='string'||phrase.length>60||phrase&&(!phrase.endsWith('して')||/[?？]|しない|しないで|するな|しなく|やめて/.test(phrase)))throw new Error('音声命令は「して」で終わる明確な命令にしてください');
 return {id:record.id,label:record.label,pulses:record.pulses.slice(),carrier:record.carrier,phrase};
}
export function createIRRemote({read,save,backend,available=()=>true,now=()=>Date.now()}){
 let learning=null,error='',last=null,lastSend=-Infinity,minuteSends=[];
 const data=()=>read()||{configured:false,commands:[]};
 const checked=()=>{const d=data();if(!d.configured||![1,2].includes(d.tx)||![1,2].includes(d.rx)||d.tx===d.rx)throw new Error('外付けIR送受信モジュールをPort Aへ接続・設定してください');return d;};
 const status=()=>({configured:data().configured===true,learning:learning?{id:learning.id,label:learning.label,until:learning.until}:null,error,last,commands:(data().commands||[]).map(({id,label,phrase})=>({id,label,phrase}))});
 const cancel=()=>{backend.close();learning=null;return status();};
 function send(id){const d=checked(),record=validateIR((d.commands||[]).find(c=>c.id===id));
  if(learning||!available())throw new Error('本体の処理・学習が終わってから送信してください');
  minuteSends=minuteSends.filter(t=>now()-t<60000);if(now()-lastSend<500||minuteSends.length>=20)throw new Error('送信間隔を空けてください');
  lastSend=now();minuteSends.push(now());backend.transmit(d.tx,new Uint16Array(record.pulses).buffer,record.carrier);last={id,at:now(),state:'sent',applianceConfirmed:false};return status();
 }
 return {status,cancel,send,configure(args){
  if(args.confirmed!==true||![1,2].includes(args.tx)||![1,2].includes(args.rx)||args.tx===args.rx)throw new Error('Port Aの配線を確認してGPIO1/2を指定してください');
  cancel();save({...data(),configured:true,tx:args.tx,rx:args.rx});return status();
 },learn(args){const d=checked();if(learning||!available())throw new Error('本体で処理中です');if(!validId(args.id)||typeof args.label!=='string'||!args.label.trim()||args.label.length>40)throw new Error('登録名・IDを確認してください');if((d.commands||[]).length>=12&&!(d.commands||[]).some(c=>c.id===args.id))throw new Error('登録は12件までです');
  // Validate names/voice phrase before acquiring a hardware resource.
  validateIR({...args,pulses:[1000,1000,1000],carrier:38000});backend.receiveStart(d.rx);learning={id:args.id,label:args.label,phrase:args.phrase||'',until:now()+10000};error='';return status();
 },tick(){if(!learning)return;try{if(now()>=learning.until){cancel();error='10秒以内に信号を受信できませんでした';return;}const bytes=backend.receivePoll();if(!bytes)return;const item=validateIR({...learning,pulses:Array.from(new Uint16Array(bytes)),carrier:38000}),d=data();save({...d,commands:[...(d.commands||[]).filter(c=>c.id!==item.id),item]});learning=null;error='';}catch(_){cancel();error='学習できませんでした。対応するリモコンで再試行してください';}},
 delete(args){if(args.confirmed!==true||!validId(args.id)||learning)throw new Error('削除を確認してください');save({...data(),commands:(data().commands||[]).filter(c=>c.id!==args.id)});return status();},
 voice(text,checkOnly=false){const phrase=String(text||'').trim();const matches=(data().commands||[]).filter(c=>c.phrase&&c.phrase===phrase);if(matches.length!==1)return false;if(checkOnly)return true;send(matches[0].id);return true;}
 };
}
