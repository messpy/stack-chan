// Daily wall-clock edges. Manual changes last until the next edge; no boot catch-up.
export function validateAISchedule(value){
 if(!value||typeof value.enabled!=='boolean'||!Number.isInteger(value.on)||!Number.isInteger(value.off)||value.on<0||value.on>1439||value.off<0||value.off>1439||value.on===value.off)throw new Error('ON/OFFを異なる時刻に設定してください');
 return {enabled:value.enabled,on:value.on,off:value.off};
}
export function createAISchedule({read,save,apply,ready,now=()=>Date.now()}){
 let previous,working=false,last=null,error='';
 const settings=()=>{try{return validateAISchedule(read()||{enabled:false,on:480,off:1380});}catch(_){return {enabled:false,on:480,off:1380};}};
 const minute=()=>Math.floor((now()+9*3600000)/60000);
 const status=()=>({...settings(),timezone:'Asia/Tokyo',clockReady:ready(),working,last,error,manualPriority:'next-edge'});
 return {status,configure(value){const next=validateAISchedule(value);save(next);previous=ready()?minute():undefined;error='';return status();},async tick(){
  if(!ready()){previous=undefined;return;}
  const current=minute(),s=settings(),before=previous;previous=current;
  if(!s.enabled||before===undefined||current<=before||current-before>5||working)return;
  const edge=[0,-1].flatMap(day=>[s.on,s.off].map((at,i)=>({at:(Math.floor(current/1440)+day)*1440+at,on:i===0}))).filter(e=>e.at>before&&e.at<=current).sort((a,b)=>a.at-b.at).pop();
  if(!edge)return;
  last={at:now(),on:edge.on,state:'pending'};
  working=true;
  try{await apply(edge.on);last.state='applied';error='';}catch(_){last.state='failed';error='AIの設定・接続状態を確認してください';}finally{working=false;}
 }};
}
