// One bounded asynchronous request; duplicate IDs are never executed again.
export function createTextRequest({run,now=()=>Date.now()}){
 let current,serial=0;const seen=[];
 const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(id);
 const status=id=>{if(!current||id&&current.id!==id)throw new Error('送信結果がありません');return {...current};};
 return {status,cancel(id){if(!current||id!==current.id)throw new Error('送信IDを確認してください');if(current.state==='pending'){serial++;current={...current,state:'cancelled'};}return status(id);},start(args){
  if(!validId(args.id)||typeof args.text!=='string'||!args.text.trim()||args.text.length>2000||ArrayBuffer.fromString(args.text).byteLength>8192||args.speak!==undefined&&typeof args.speak!=='boolean')throw new Error('文章は2000文字・8KiB以内で入力してください');
  if(current?.id===args.id)return status(args.id);
  if(seen.includes(args.id))throw new Error('この送信IDは処理済みです');
  if(current?.state==='pending')throw new Error('前の回答を待つかキャンセルしてください');
  seen.push(args.id);if(seen.length>32)seen.shift();const ticket=++serial;
  current={id:args.id,state:'pending',started:now()};
  const active=()=>serial===ticket&&current?.state==='pending';
  Promise.resolve().then(()=>run({...args,text:args.text.trim()},active)).then(result=>{if(active())current={...current,...result,state:'completed',finished:now()};},failure=>{if(active()){
   const messages={
    'Wi-Fiへ接続してください':'本体をインターネット接続のあるWi-Fiへ接続してください',
    'AIの接続設定が必要です':'設定タブで選択中のAIの接続設定を確認してください',
    'XiaoZhiへの機器登録が必要です':'XiaoZhiへの機器登録が必要です',
    'XiaoZhiのカメラ接続がタイムアウトしました':'XiaoZhiへの接続がタイムアウトしました',
    '日本語の回答を取得できませんでした':'XiaoZhiの回答がタイムアウトしました',
    'XiaoZhiのカメラ接続が切れました':'XiaoZhiとの接続が切れました',
    '本体で処理中です':'本体の処理が終わってから送信してください',
    'OTA connection failed':'XiaoZhiの登録情報を更新できませんでした',
    'OTA request timed out':'XiaoZhiの登録情報の更新がタイムアウトしました'
   };
   current={...current,state:'failed',error:messages[failure?.message]||'AIへの送信に失敗しました。接続・認証設定を確認してください',finished:now()};
  }});
  return status(args.id);
 }};
}
