import SPEAKER_PAGE from 'archive-speaker-page';
import IMAGE_PAGE from 'archive-image-page';
export default `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StackChan 本体</title><style>body{font:16px system-ui;background:#f4f5ef;color:#173c37;margin:0}main{max-width:760px;margin:auto;padding:20px}section{background:white;padding:18px;border-radius:16px;margin:16px 0}button,input{font:inherit;padding:12px;border:1px solid #b8c8c0;border-radius:9px}button{background:#236a5a;color:white;margin:4px}button:disabled{opacity:.5}img,canvas{max-width:100%;image-rendering:auto}article{border-top:1px solid #ddd;padding:12px 0}audio{width:100%}#notice{white-space:pre-wrap}small{color:#546b60}.row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
/* Camera and direction controls stay together. */
.camera-head-panel{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.head-pad{display:grid;grid-template-columns:repeat(3,64px);grid-template-areas:". up ." "left center right" ". down .";gap:4px}.head-pad button{margin:0;min-height:52px;touch-action:none;user-select:none;-webkit-user-select:none}.head-up{grid-area:up}.head-down{grid-area:down}.head-left{grid-area:left}.head-right{grid-area:right}.head-center{grid-area:center}#headState{max-width:220px;min-height:2.5em}
/* Category navigation shared by the LAN and PC screens. */
.live-options label{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid #c6d3ca;border-radius:10px;background:#f6f8f3;cursor:pointer}.live-options input[type="checkbox"]{width:20px;height:20px;margin:0;padding:0;accent-color:#236a5a;flex:none}
[hidden]{display:none!important}*{box-sizing:border-box}
.category-nav{display:flex;gap:6px;position:sticky;top:0;z-index:5;padding:10px 0;margin:16px 0 6px;background:#f4f5ef;overflow-x:auto;border-bottom:1px solid #d7e1d8;scrollbar-width:thin}
.category-nav a{flex:1 0 auto;text-align:center;text-decoration:none;white-space:nowrap;padding:12px 16px;border-radius:12px;color:#46665f;font-weight:600;background:#e6ede6;min-height:44px}
.category-nav a[aria-selected="true"]{background:#173e3b;color:#fff;box-shadow:0 3px 8px #173e3b20}
.category-nav a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #d89339;outline-offset:3px}
.category-caption{margin:16px 2px;color:#627771;font-size:14px;line-height:1.6}
[data-category] h2{font-size:20px;margin:0 0 16px}[data-category] h3{font-size:16px;margin:24px 0 10px}
[data-category] p{line-height:1.65}[data-category] input,[data-category] select,[data-category] textarea{max-width:100%}
[data-category] summary{cursor:pointer;font-weight:600;padding:6px 0}
#state{padding:10px 14px;border-radius:12px;background:#e6ede6;font-size:14px}
#notice:empty{display:none}#notice:not(:empty){padding:12px 16px;border-radius:12px;background:#fff4dc;border:1px solid #ead6a5;white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:520px){main{padding:16px 12px}.category-nav{gap:5px}.category-nav a{padding:11px 12px;font-size:14px}[data-category] section,[data-category] .card{padding:16px;border-radius:15px}[data-category] .row{gap:6px}[data-category] button{max-width:100%;white-space:normal}}
</style><main><h1>StackChan 本体</h1><p id="state">本体へ接続中…</p><p id="notice" role="status"></p><nav class="category-nav" role="tablist" aria-label="操作カテゴリ"><a id="tab-talk" href="#view-talk" role="tab" data-category-link="talk" aria-controls="view-talk" aria-selected="true" tabindex="0">会話</a><a id="tab-control" href="#view-control" role="tab" data-category-link="control" aria-controls="view-control" aria-selected="false" tabindex="-1">カメラ・操作</a><a id="tab-records" href="#view-records" role="tab" data-category-link="records" aria-controls="view-records" aria-selected="false" tabindex="-1">記録</a><a id="tab-settings" href="#view-settings" role="tab" data-category-link="settings" aria-controls="view-settings" aria-selected="false" tabindex="-1">設定</a></nav><div id="view-talk" data-category="talk" role="tabpanel" aria-labelledby="tab-talk"><p class="category-caption">会話を始める・終える、話す人を選ぶ。</p><section id="chat-controls"><h2>会話</h2><button id="talk">会話を始める</button><button id="stop">会話を終了</button><p id="chatState"></p><small>会話は本体のマイクとスピーカーを使います。クラウド会話には本体のインターネット接続が必要です。</small></section><section><h2>文字起こしのみ</h2><p>AI会話をOFFにしても使えます。音声をXiaoZhiへ送り、認識した文章を本体と履歴に残します。返答や操作は行いません。</p><button id="transcriptionToggle" data-enabled="false">文字起こしをON</button><p id="transcriptionState" role="status"></p></section><section id="speakerSection" class="card"><h2>話す人を選択</h2><p id="speakerCurrent" role="status">登録済みの人を確認しています…</p><div id="speakerPeople" class="row"></div><button id="openRegistration" type="button">登録</button><details id="speakerRegistration"><summary>登録情報を入力</summary><form id="speakerForm"><p><label>名前 <input id="speakerName" maxlength="80" required autocomplete="off"></label></p><p><label>ニックネーム <input id="speakerNick" maxlength="160" placeholder="複数ある場合は、で区切る"></label></p><p><label>好きなもの <input id="speakerLikes" maxlength="240"></label></p><p><label>どんな人？ <input id="speakerAbout" maxlength="240"></label></p><button type="submit">登録して会話を始める</button></form></details><button id="guestSpeaker" type="button">ゲストで会話</button><p id="speakerNotice" role="status"></p><small>選択した人の短いプロフィールと、関連する直近3件だけをAIの参考情報にします。</small></section></div><div id="view-control" data-category="control" role="tabpanel" aria-labelledby="tab-control" hidden><p class="category-caption">本体の映像や音を確認して、首・LED・読み上げを操作。</p><section id="monitor"><h2>本体の動作確認</h2><p>同じWi-Fiからカメラ・マイク・首・LED・読み上げを確認できます。使用中はAI会話を一時停止し、終了すると戻ります。画像と音声は保存・AI送信しません。</p><div class="row"><button id="monitorBegin">動作確認を開始</button><button id="monitorEnd" disabled>動作確認を終了</button></div><p id="monitorState" role="status">停止中</p><h3>LIVE</h3><div class="row live-options"><label><input id="liveCamera" type="checkbox" checked> カメラ</label><label><input id="liveAudio" type="checkbox"> 音声</label></div><div class="row"><button id="liveStart">LIVEを見る</button><button id="liveStop" disabled>LIVEを停止</button></div><p id="liveState" role="status">停止中</p><div class="camera-head-panel"><img id="cameraPreview" hidden alt="StackChan本体カメラのLIVE映像" style="width:352px;max-width:100%"><div><h3>首の向き</h3><div class="head-pad"><button id="pose-up" class="head-up" aria-label="上へ（長押し）">上</button><button id="pose-left" class="head-left" aria-label="左へ（長押し）">左</button><button id="pose-center" class="head-center">正面</button><button id="pose-right" class="head-right" aria-label="右へ（長押し）">右</button><button id="pose-down" class="head-down" aria-label="下へ（長押し）">下</button></div><p id="headState" role="status">押している間だけ移動。離すと停止。</p></div></div><p><small>カメラ・音声を選んで「LIVEを見る」。映像を見ながら方向ボタンを長押しできます。可動範囲の端では止まります。「正面」は1回押すと中央へ戻ります。</small></p><h3>LED</h3><div class="row"><input type="color" id="monitorColor" value="#00ff00" aria-label="LEDの色"><button id="monitorLED">この色にする</button><button id="monitorRainbow">虹色</button><button id="monitorLEDOff">消灯</button></div><h3>テキストを読み上げる</h3><p><textarea id="monitorText" rows="3" maxlength="200" style="width:100%;box-sizing:border-box;font:inherit" placeholder="本体に読み上げてほしい文字（200文字まで）" aria-label="読み上げる文字"></textarea></p><p class="live-options"><label><input id="monitorSubtitles" type="checkbox"> 字幕を表示（本体・この画面）</label></p><button id="monitorSpeak">本体で読み上げる</button><p id="speechCaption" hidden style="white-space:pre-wrap;padding:12px;background:#e6ede6;border-radius:10px"></p><p><small>本体の日本語合成音声を使います。音量は「設定」タブで調整できます。</small></p></section><section><h2>撮影・録音</h2><p>AI認識は選択中のサービス（Gemini／XiaoZhi／Ollama Cloud）へ画像を送信します。</p><div class="row"><button id="photo">写真を撮ってAI認識</button><button id="photoLocal">写真の保存のみ</button><button id="record">5秒の音声付き動画</button><button id="audio">5秒録音</button></div></section><section class="card"><h2>画像を送ってAIに聞く</h2><p>選択中のGemini／XiaoZhi／Ollama Cloudへ送信します。画像は最大800pxのJPEGに変換して本体SDに保存し、質問・回答と会話履歴に残します。</p><input id="imageFile" type="file" accept="image/jpeg,image/png,image/webp"><p><input id="imageQuestion" maxlength="1000" placeholder="画像についての質問（省略可）"></p><button id="sendImage">画像を保存してAIに聞く</button><p id="imageProgress" role="status"></p><img id="imagePreview" hidden alt="SDへ保存した画像" style="max-width:100%;max-height:260px"><p id="imageAnswer" style="white-space:pre-wrap"></p></section></div><div id="view-records" data-category="records" role="tabpanel" aria-labelledby="tab-records" hidden><p class="category-caption">SDに保存した写真・動画・録音と、会話の記録。</p><section><h2>SDの写真・動画・録音</h2><button id="refresh">一覧を更新</button><div id="media"></div><details id="trashDetails"><summary>ごみ箱・復元</summary><p>削除した写真・動画・録音を元に戻せます。会話の文章やプロフィールは削除しません。</p><button id="refreshTrash">ごみ箱を更新</button><div id="trashItems"></div><button id="moreTrash" hidden>続きを表示</button></details></section><section><h2>会話の記録</h2><div id="messages"></div></section></div><div id="view-settings" data-category="settings" role="tabpanel" aria-labelledby="tab-settings" hidden><p class="category-caption">AIサービス・APIキー、音量、見た目の設定。</p><section id="conversation"><h2>AIサービス設定</h2><label>会話サービス <select id="provider"><option value="xiaozhi">XiaoZhi</option><option value="gemini">Gemini Live</option><option value="ollama">Ollama Cloud</option></select></label><p><label>音声認識 <select id="speechRecognition"><option value="auto">自動（従来どおり）</option><option value="xiaozhi">XiaoZhiで文字起こし</option></select></label><p>XiaoZhi認識では音声をXiaoZhiへ送信し、文字を選択したAIへ渡します。読み上げは本体内蔵音声です。公式クラウドの文字起こし専用APIではありません。</p><input id="geminiTextModel" maxlength="100" placeholder="Gemini文字応答モデル（空欄は標準）"><input id="geminiKey" type="password" autocomplete="new-password" placeholder="選択したAIのAPIキー（変更時のみ）"><input id="ollamaModel" maxlength="100" placeholder="Ollamaモデル（空欄: gemma4:31b）"><button id="saveProvider">会話設定を保存</button></p><p>Ollama Cloudの返答・画像にはOllamaキーを使います。自動認識ではGeminiキー、XiaoZhi認識ではXiaoZhiの登録が必要です。Ollamaモデル欄はOllama専用です。</p><button id="checkOllama">保存済みOllamaキー・モデルを確認</button><p id="ollamaCheck" role="status"></p><button id="checkGemini">保存済みGeminiキーを確認</button><p id="geminiCheck" role="status"></p><small>Geminiで会話ON中は音声をGoogleへ送信します。キーはSDに暗号化して保存し、画面に再表示しません。</small></section><section><h2>音量</h2><div class="row"><strong id="volume">—%</strong><button id="quieter">−10%</button><button id="louder">＋10%</button><button id="mute">消音</button></div></section><section><h2>顔を描く</h2><p>今の顔をテンプレートに、目や口を自由に描いて本体へ反映できます。</p><a href="/face-editor">顔のアトリエを開く</a></section></div></main><script>
const el=id=>document.getElementById(id);let volume=20,working=false,providerUpdating=false;
if(location.search)history.replaceState(null,'',location.pathname+location.hash);
async function rpc(op,args){const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:op,args:args||{}})});const result=await r.json();if(!r.ok)throw Error(result.error||'本体で処理できませんでした');return result;}
async function status(){try{const s=await rpc('/status');el('state').textContent=s.busy?'本体で処理中':'本体に接続済み・SD '+(s.sd?'認識済み':'未認識');const v=await rpc('/volume');volume=v.percent;el('volume').textContent=volume+'%';const c=await rpc('/chat/status');el('transcriptionToggle').dataset.enabled=String(!!c.recognitionMode);el('transcriptionToggle').textContent=c.recognitionMode?'文字起こしをOFF':'文字起こしをON';el('transcriptionState').textContent=c.recognitionMode?c.label:'停止中';if(!providerUpdating&&document.activeElement!==el('provider'))el('provider').value=c.provider||'xiaozhi';if(!providerUpdating&&document.activeElement!==el('speechRecognition'))el('speechRecognition').value=c.recognition||'auto';el('chatState').textContent=(c.provider==='ollama'?'Ollama Cloud: ':c.provider==='gemini'?'Gemini: ':'XiaoZhi: ')+(c.error||c.label||c.state||'待機中');}catch(e){el('state').textContent=e.message;}}
async function capture(op,args){if(monitorId){el('notice').textContent='動作確認を終了してから撮影・録音してください';return;}if(working||providerUpdating)return;working=true;for(const id of ['photo','photoLocal','record','audio'])el(id).disabled=true;el('notice').textContent='本体で記録しています…';try{const r=await rpc('/'+op,args);el('notice').textContent=r.analysis?(r.analysis.text||r.analysis.error):'SDに保存しました: '+r.name;await gallery();}catch(e){el('notice').textContent=e.message;}finally{working=false;for(const id of ['photo','photoLocal','record','audio'])el(id).disabled=false;}}
for(const id of ['photo','photoLocal','record','audio'])el(id).onclick=()=>capture(id==='photoLocal'?'photo':id,id==='photoLocal'?{analyze:false}:{});
let cameraRunning=false,cameraTimer,cameraAbort,cameraURL,cameraGeneration=0,cameraLastFrameAt=0;
let monitorEpoch=0,monitorId='',monitorStarting,monitorTimer,monitorEnding=false;
let audioContext,audioOn=false,audioTimer,audioAbort,audioNext=0;
let liveGeneration=0,liveStarting=false,speechCaptionTimer;
const audioNodes=new Set();
function monitorMessage(text){el('monitorState').textContent=text;}
function clearSpeechCaption(){clearTimeout(speechCaptionTimer);el('speechCaption').hidden=true;el('speechCaption').textContent='';}
function stopCamera(){
 cameraRunning=false;cameraGeneration++;clearTimeout(cameraTimer);cameraAbort?.abort();
 if(cameraURL){URL.revokeObjectURL(cameraURL);cameraURL=undefined;}
 el('cameraPreview').hidden=true;el('cameraPreview').removeAttribute('src');
}
function stopMonitorAudio(){
 audioOn=false;clearTimeout(audioTimer);audioAbort?.abort();
 for(const node of audioNodes){try{node.stop();}catch(_){}node.disconnect();}audioNodes.clear();
 audioNext=0;
 if(audioContext){audioContext.close().catch(()=>{});audioContext=undefined;}
}
function resetLive(){
 void stopHeadControls();liveGeneration++;stopCamera();stopMonitorAudio();
 el('liveStart').disabled=liveStarting;el('liveStop').disabled=true;el('liveState').textContent='停止中';
}
async function stopLive(){
 const hadAudio=audioOn,id=monitorId;resetLive();
 if(hadAudio&&id)try{await rpc('/monitor/audio',{id,enabled:false});}catch(error){monitorMessage(error.message);}
}
async function ensureMonitor(){
 if(monitorEnding)throw Error('動作確認を終了しています');
 if(monitorId)return monitorId;
 if(!monitorStarting)monitorStarting=(async()=>{
  const epoch=monitorEpoch,result=await rpc('/monitor/start');
  if(epoch!==monitorEpoch||document.hidden){await rpc('/monitor/stop',{id:result.id});throw Error('動作確認を中止しました');}
  monitorId=result.id;el('monitorEnd').disabled=false;el('monitorBegin').disabled=true;
  monitorMessage('動作確認中・AI会話は一時停止しています');
  monitorTimer=setInterval(async()=>{if(!monitorId)return;try{await rpc('/monitor/status',{id:monitorId});}catch(error){await endMonitor(error.message);}},2000);
  return monitorId;
 })().finally(()=>{monitorStarting=undefined;});
 return monitorStarting;
}
async function endMonitor(message='動作確認を終了しました'){
 if(monitorEnding)return;monitorEnding=true;monitorEpoch++;void stopHeadControls();
 resetLive();clearSpeechCaption();clearInterval(monitorTimer);
 const id=monitorId;monitorId='';
 try{if(id)await rpc('/monitor/stop',{id});}
 catch(error){message=error.message;}
 finally{monitorEnding=false;el('monitorEnd').disabled=true;el('monitorBegin').disabled=false;monitorMessage(message);}
}
async function monitorCommand(action,args){
 try{const id=await ensureMonitor();monitorMessage('操作中…');await rpc('/monitor/command',{id,action,arguments:args});monitorMessage('操作しました');}
 catch(error){monitorMessage(error.message);}
}
async function nextCameraFrame(){
 if(!cameraRunning||!monitorId)return;
 const generation=cameraGeneration,id=monitorId,controller=new AbortController();cameraAbort=controller;
 const deadline=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch('/camera/frame?session='+encodeURIComponent(id),{cache:'no-store',signal:controller.signal});
  if(!response.ok){let message='カメラに接続できませんでした';try{message=(await response.json()).error||message;}catch(_){}throw Error(message);}
  const blob=await response.blob();if(!cameraRunning||generation!==cameraGeneration||monitorId!==id)return;
  cameraLastFrameAt=Date.now();const previous=cameraURL;cameraURL=URL.createObjectURL(blob);
  el('cameraPreview').src=cameraURL;el('cameraPreview').hidden=false;if(previous)URL.revokeObjectURL(previous);
  cameraTimer=setTimeout(nextCameraFrame,1000);
 }catch(error){if(cameraRunning&&generation===cameraGeneration){await stopLive();monitorMessage(error.name==='AbortError'?'カメラの応答がタイムアウトしました':error.message);}}
 finally{clearTimeout(deadline);if(cameraAbort===controller)cameraAbort=undefined;}
}
async function nextMonitorAudio(){
 if(!audioOn||!monitorId)return;
 const id=monitorId,context=audioContext,controller=new AbortController();audioAbort=controller;
 const deadline=setTimeout(()=>controller.abort(),8000);
 try{
  const response=await fetch('/monitor/audio?session='+encodeURIComponent(id),{cache:'no-store',signal:controller.signal});
  if(!response.ok){let message='音声を取得できませんでした';try{message=(await response.json()).error||message;}catch(_){}throw Error(message);}
  const pcm=await response.arrayBuffer();if(!audioOn||audioContext!==context||monitorId!==id)return;
  if(pcm.byteLength>=2){
   const frames=pcm.byteLength>>1,buffer=context.createBuffer(1,frames,16000),out=buffer.getChannelData(0),view=new DataView(pcm);
   for(let i=0;i<frames;i++)out[i]=view.getInt16(i*2,true)/32768;
   const node=context.createBufferSource();node.buffer=buffer;node.connect(context.destination);audioNext=Math.max(audioNext,context.currentTime+.15);
   if(audioNext>context.currentTime+1.5){for(const old of audioNodes){old.stop();old.disconnect();}audioNodes.clear();audioNext=context.currentTime+.15;}
   audioNodes.add(node);node.onended=()=>{audioNodes.delete(node);node.disconnect();};node.start(audioNext);audioNext+=frames/16000;
  }
  audioTimer=setTimeout(nextMonitorAudio,150);
 }catch(error){if(audioOn&&audioContext===context){await stopLive();monitorMessage(error.name==='AbortError'?'音声の応答がタイムアウトしました':error.message);}}
 finally{clearTimeout(deadline);if(audioAbort===controller)audioAbort=undefined;}
}
el('liveStart').onclick=async()=>{
 if(liveStarting)return;
 const camera=el('liveCamera').checked,audio=el('liveAudio').checked;
 if(!camera&&!audio){await stopLive();el('liveState').textContent='カメラか音声にチェックを入れてください。';return;}
 liveStarting=true;el('liveStart').disabled=true;
 let candidate,generation;
 try{
  // Resume during the user's click, before any network waits (mobile autoplay).
  if(audio){const Type=window.AudioContext||window.webkitAudioContext;if(!Type)throw Error('このブラウザは音声モニターに対応していません');candidate=new Type();const ready=candidate.resume(),stopped=stopLive();generation=liveGeneration;await stopped;await ready;}
  else{const stopped=stopLive();generation=liveGeneration;await stopped;}
  if(generation!==liveGeneration)return;
  el('liveStop').disabled=false;el('liveState').textContent='LIVEに接続中…';
  const id=await ensureMonitor();if(generation!==liveGeneration||monitorId!==id)return;
  if(audio){await rpc('/monitor/audio',{id,enabled:true});if(generation!==liveGeneration||monitorId!==id){rpc('/monitor/audio',{id,enabled:false}).catch(()=>{});return;}audioContext=candidate;candidate=undefined;audioOn=true;nextMonitorAudio();}
  if(camera){cameraRunning=true;cameraLastFrameAt=Date.now();nextCameraFrame();}
  el('liveState').textContent='LIVE中：'+(camera&&audio?'カメラ＋音声':camera?'カメラのみ':'音声のみ');
 }catch(error){resetLive();monitorMessage(error.message);}
 finally{if(candidate)candidate.close().catch(()=>{});liveStarting=false;el('liveStart').disabled=false;}
};
el('liveStop').onclick=()=>stopLive();
el('monitorBegin').onclick=()=>ensureMonitor().catch(error=>monitorMessage(error.message));
el('monitorEnd').onclick=()=>endMonitor();
// Press-and-hold head controls. Sequence numbers reject delayed renewals after release.
let headHold,headInterval,headSequence=0;
async function stopHeadControls(event){
 const hold=headHold;
 if(!hold||event&&event.pointerId!==undefined&&hold.pointer!==undefined&&event.pointerId!==hold.pointer)return;
 headHold=undefined;clearInterval(headInterval);headInterval=undefined;
 const sequence=++headSequence;el('headState').textContent='停止';
 if(hold.id)try{await rpc('/monitor/command',{id:hold.id,action:'pose_hold',arguments:{held:false,sequence}});}catch(_){}
}
async function beginHeadControls(direction,event){
 if(headHold||event.button!==undefined&&event.button!==0)return;
 event.preventDefault();
 const hold=headHold={direction,sequence:++headSequence,pointer:event.pointerId,id:'',sending:false};
 if(event.pointerId!==undefined)event.currentTarget?.setPointerCapture?.(event.pointerId);
 el('headState').textContent='首の操作を準備しています…';
 try{
  hold.id=await ensureMonitor();
  if(headHold!==hold)return;
  const pulse=async()=>{
   if(headHold!==hold||hold.sending)return;
   if(cameraRunning&&Date.now()-cameraLastFrameAt>3000){await stopHeadControls();el('headState').textContent='映像の更新が止まったため、首を停止しました';return;}
   hold.sending=true;
   try{
    const result=await rpc('/monitor/command',{id:hold.id,action:'pose_hold',arguments:{direction,held:true,sequence:hold.sequence}});
    if(headHold===hold&&result.ready===true&&result.moving===false&&!result.atLimit){await stopHeadControls();el('headState').textContent='停止しました。離して押し直してください';return;}
    if(headHold===hold)el('headState').textContent=result.atLimit?'可動範囲の端です':result.ready===false?'首の位置を確認しています…':'押している間、動きます';
   }catch(error){if(headHold===hold){await stopHeadControls();el('headState').textContent=error.message;}}
   finally{hold.sending=false;}
  };
  headInterval=setInterval(pulse,250);void pulse();
 }catch(error){if(headHold===hold){await stopHeadControls();el('headState').textContent=error.message;}}
}
for(const direction of ['up','down','left','right']){
 const button=el('pose-'+direction);
 button.onpointerdown=event=>beginHeadControls(direction,event);
 button.onpointerup=stopHeadControls;button.onpointercancel=stopHeadControls;button.onlostpointercapture=stopHeadControls;
 button.oncontextmenu=event=>event.preventDefault();
 button.onkeydown=event=>{if((event.key===' '||event.key==='Enter')&&!event.repeat)beginHeadControls(direction,event);};
 button.onkeyup=event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();void stopHeadControls();}};
}
window.addEventListener('pointerup',stopHeadControls);
window.addEventListener('pointercancel',stopHeadControls);
window.addEventListener('blur',()=>{void stopHeadControls();});
el('pose-center').onclick=async()=>{await stopHeadControls();await monitorCommand('pose',{direction:'center'});};
// End press-and-hold head controls.

el('monitorLED').onclick=()=>monitorCommand('led',{mode:'color',color:el('monitorColor').value});
el('monitorRainbow').onclick=()=>monitorCommand('led',{mode:'rainbow'});
el('monitorLEDOff').onclick=()=>monitorCommand('led',{mode:'off'});
el('monitorSpeak').onclick=async()=>{
 el('monitorSpeak').disabled=true;clearSpeechCaption();
 const subtitles=el('monitorSubtitles').checked,text=el('monitorText').value;
 if(subtitles&&text.trim()){el('speechCaption').textContent=text;el('speechCaption').hidden=false;}
 try{await monitorCommand('speak',{text,subtitles});}
 finally{el('monitorSpeak').disabled=false;if(subtitles)speechCaptionTimer=setTimeout(clearSpeechCaption,5000);}
};
function leaveMonitor(){
 monitorEpoch++;void stopHeadControls();resetLive();clearSpeechCaption();clearInterval(monitorTimer);
 const id=monitorId;monitorId='';
 if(id)fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'/monitor/stop',args:{id}}),keepalive:true}).catch(()=>{});
 el('monitorBegin').disabled=false;el('monitorEnd').disabled=true;monitorMessage('停止中');
}
window.addEventListener('pagehide',leaveMonitor);
document.addEventListener('visibilitychange',()=>{if(document.hidden)leaveMonitor();});

async function changeVolume(value){try{const r=await rpc('/volume',{percent:Math.max(0,Math.min(100,value)),preview:true});volume=r.percent;el('volume').textContent=volume+'%';}catch(e){el('notice').textContent=e.message;}}
el('quieter').onclick=()=>changeVolume(volume-10);el('louder').onclick=()=>changeVolume(volume+10);el('mute').onclick=()=>changeVolume(0);
async function saveProvider(includeKey){if(providerUpdating)return;providerUpdating=true;el('saveProvider').disabled=true;try{const result=await rpc('/chat/provider',{provider:el('provider').value,recognition:el('speechRecognition').value,...(el('geminiTextModel').value.trim()?{textModel:el('geminiTextModel').value.trim()}:{}),...(el('provider').value==='ollama'&&el('ollamaModel').value.trim()?{model:el('ollamaModel').value.trim()}:{}),...(includeKey?{apiKey:el('geminiKey').value}:{})});if(result.error)throw Error(result.error);if(includeKey)el('geminiKey').value='';el('chatState').textContent='会話・画像認識: '+(result.provider==='ollama'?'Ollama Cloud':result.provider==='gemini'?'Gemini':'XiaoZhi');return true;}catch(e){el('chatState').textContent=e.message;return false;}finally{providerUpdating=false;el('saveProvider').disabled=false;await status();}}
el('provider').onchange=()=>saveProvider(false);el('speechRecognition').onchange=()=>saveProvider(false);
el('saveProvider').onclick=()=>saveProvider(true);

el('checkOllama').onclick=async()=>{el('checkOllama').disabled=true;el('ollamaCheck').textContent='Ollama Cloudに接続確認中…';try{const r=await rpc('/chat/ollama-test');el('ollamaCheck').textContent=r.authenticated?'Ollama Cloud接続成功: '+r.model:r.error||'接続できませんでした';}catch(e){el('ollamaCheck').textContent=e.message;}finally{el('checkOllama').disabled=false;}};
el('checkGemini').onclick=async()=>{el('checkGemini').disabled=true;el('geminiCheck').textContent='保存済みキーでGoogleへの接続を確認中…';try{const r=await rpc('/chat/gemini-test');el('geminiCheck').textContent=r.authenticated?'Google認証に成功しました。キーは利用可能です。':r.error||'接続を確認できませんでした';}catch(e){el('geminiCheck').textContent=e.message;}finally{el('checkGemini').disabled=false;}};
el('talk').onclick=async()=>{if(providerUpdating)return;try{if(!await saveProvider(false))return;el('chatState').textContent='会話を接続中…';await rpc('/chat/start');await status();}catch(e){el('chatState').textContent=e.message;}};
el('transcriptionToggle').onclick=async()=>{const button=el('transcriptionToggle');button.disabled=true;try{await rpc('/recognition/mode',{enabled:button.dataset.enabled!=='true'});await status();}catch(e){el('transcriptionState').textContent=e.message;}finally{button.disabled=false;}};
el('stop').onclick=async()=>{try{await rpc('/chat/stop');await status();await messages();}catch(e){el('chatState').textContent=e.message;}};
async function gallery(){const list=await rpc('/files');el('media').replaceChildren();for(const f of list.filter(f=>!f.name.endsWith('.json')).slice(-30).reverse()){const article=document.createElement('article'),name=document.createElement('p'),url='/media?name='+encodeURIComponent(f.name);name.textContent=f.name;article.append(name);if((/\.(bmp|jpg)$/).test(f.name)){const img=document.createElement('img');img.src=url;img.alt='StackChanで撮影した写真';img.loading='lazy';article.append(img);}else if(f.name.endsWith('.wav')){const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=url;article.append(audio);}else if(f.name.endsWith('.avi')){const play=document.createElement('button');play.textContent='音声付きで再生';play.onclick=()=>playAVI(url,article,play);article.append(play);}const a=document.createElement('a');a.href=url;a.download=f.name;a.textContent='保存する';article.append(a);if(deletableMediaName(f.name)){const remove=document.createElement('button');remove.textContent='削除';remove.style.background='#8d403b';remove.onclick=()=>editMedia('delete',f.name,remove);article.append(remove);}el('media').append(article);}}
const deletableMediaName=name=>/^(?:photo-[a-z0-9-]+[.](?:jpg|bmp)|video-[a-z0-9-]+[.]avi|audio-[a-z0-9-]+[.]wav)$/.test(name);
let mediaEditing=false,trashLoading=false,trashNext=null;
async function editMedia(action,name,button){
 if(mediaEditing)return;
 if(action==='delete'&&!confirm(name+'を本体SDのごみ箱へ移動しますか？ 後から復元できます。'))return;
 mediaEditing=true;button.disabled=true;
 try{await rpc('/media/'+action,{name});el('notice').textContent=action==='delete'?'ごみ箱へ移動しました。':'復元しました。';await gallery();await messages();await loadTrash();}
 catch(error){el('notice').textContent=error.message;}
 finally{mediaEditing=false;button.disabled=false;}
}
async function loadTrash(append=false){
 if(trashLoading)return;trashLoading=true;
 try{
  const result=await rpc('/media/trash',{offset:append?(trashNext||0):0,limit:50});
  if(!append)el('trashItems').replaceChildren();
  for(const item of result.items){const row=document.createElement('article'),label=document.createElement('p'),restore=document.createElement('button');label.textContent=item.name;restore.textContent='復元';restore.onclick=()=>editMedia('restore',item.name,restore);row.append(label,restore);el('trashItems').append(row);}
  if(!result.total)el('trashItems').textContent='ごみ箱は空です。';trashNext=result.next;el('moreTrash').hidden=trashNext===null;
 }catch(error){el('notice').textContent=error.message;}
 finally{trashLoading=false;}
}
el('refreshTrash').onclick=()=>loadTrash();el('moreTrash').onclick=()=>loadTrash(true);
el('trashDetails').ontoggle=()=>{if(el('trashDetails').open)loadTrash();};
async function messages(){try{const r=await fetch('/messages');if(!r.ok)return;const rows=await r.json();el('messages').replaceChildren();for(const row of rows){const p=document.createElement('p');p.textContent=(row.role==='input'||row.role==='user'?'あなた: ':'StackChan: ')+row.text;if(row.image&&row.role==='user'){const img=document.createElement('img');img.src='/media?name='+encodeURIComponent(row.image);img.alt='この質問に添付した画像';img.loading='lazy';img.style.maxHeight='200px';p.append(img);}el('messages').append(p);}}catch(_) {}}
el('refresh').onclick=async()=>{try{await gallery();await messages();}catch(e){el('notice').textContent=e.message;}};
async function playAVI(url,article,button){button.disabled=true;button.textContent='読み込み中…';let context;try{const response=await fetch(url);if(!response.ok)throw Error('動画を読み込めませんでした');const buffer=await response.arrayBuffer(),view=new DataView(buffer),bytes=new Uint8Array(buffer),frames=[],audio=[];let width=176,height=144,fps=2,rate=24000,channels=1;const tag=o=>String.fromCharCode(...bytes.subarray(o,o+4));function walk(start,end){for(let o=start;o+8<=end;){const id=tag(o),size=view.getUint32(o+4,true),body=o+8,last=body+size;if(last>end)break;if(id==='LIST')walk(body+4,last);else if(id==='avih'&&size>=40){fps=1000000/view.getUint32(body,true);width=view.getUint32(body+32,true);height=view.getUint32(body+36,true);}else if(id==='strf'&&size>=16&&view.getUint16(body,true)===1){channels=view.getUint16(body+2,true);rate=view.getUint32(body+4,true);}else if(id==='00db'||id==='00dc')frames.push(bytes.subarray(body,last));else if(id==='01wb')audio.push(bytes.subarray(body,last));o=last+(size&1);}}walk(12,buffer.byteLength);if(!frames.length||width>640||height>480)throw Error('この動画は保存して再生してください');const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;article.insertBefore(canvas,button);const draw=canvas.getContext('2d'),image=draw.createImageData(width,height),stride=(width*3+3)&~3;const audioBytes=audio.reduce((n,a)=>n+a.length,0),pcm=new Uint8Array(audioBytes);let at=0;for(const a of audio){pcm.set(a,at);at+=a.length;}let source;context=new AudioContext();await context.resume();if(audioBytes){const count=Math.floor(audioBytes/2/channels),sound=context.createBuffer(channels,count,rate),data=new DataView(pcm.buffer);for(let c=0;c<channels;c++){const target=sound.getChannelData(c);for(let i=0;i<count;i++)target[i]=data.getInt16((i*channels+c)*2,true)/32768;}source=context.createBufferSource();source.buffer=sound;source.connect(context.destination);source.start();}const start=context.currentTime;button.textContent='再生中';await new Promise(resolve=>{function tick(){const index=Math.floor((context.currentTime-start)*fps);if(index>=frames.length){resolve();return;}const frame=frames[index];for(let y=0;y<height;y++)for(let x=0;x<width;x++){const from=(height-1-y)*stride+x*3,to=(y*width+x)*4;image.data[to]=frame[from+2];image.data[to+1]=frame[from+1];image.data[to+2]=frame[from];image.data[to+3]=255;}draw.putImageData(image,0,0);requestAnimationFrame(tick);}tick();});}catch(e){el('notice').textContent=e.message;}finally{if(context)await context.close();button.disabled=false;button.textContent='音声付きで再生';}}
status();gallery().catch(e=>el('notice').textContent=e.message);messages();setInterval(()=>{if(!working)status();},3000);

// Keep all controls mounted so existing handlers and status updates retain their IDs.
(()=>{
 const panels=Array.from(document.querySelectorAll('[data-category]'));
 const tabs=Array.from(document.querySelectorAll('[data-category-link]'));
 function select(key,changeHash=false){
  if(!panels.some(panel=>panel.dataset.category===key))return;
  if(key!=='control'&&typeof leaveMonitor==='function')leaveMonitor();
  for(const panel of panels)panel.hidden=panel.dataset.category!==key;
  for(const tab of tabs){const active=tab.dataset.categoryLink===key;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
  if(changeHash)history.replaceState(null,'',location.pathname+location.search+'#view-'+key);
 }
 function fromHash(){
  let id;try{id=decodeURIComponent(location.hash.slice(1));}catch(_){id='';}
  const target=id?document.getElementById(id):null;
  const panel=target&&panels.find(panel=>panel===target||panel.contains(target));
  select(panel?panel.dataset.category:'talk');
  if(target&&panel&&target!==panel)target.scrollIntoView({block:'start'});
 }
 tabs.forEach((tab,index)=>{
  tab.onclick=event=>{event.preventDefault();select(tab.dataset.categoryLink,true);};
  tab.onkeydown=event=>{
   let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;
   event.preventDefault();select(tabs[next].dataset.categoryLink,true);tabs[next].focus();
  };
 });
 window.addEventListener('hashchange',fromHash);fromHash();
})();
</script><script>${IMAGE_PAGE}</script><script>${SPEAKER_PAGE}</script></html>`;
