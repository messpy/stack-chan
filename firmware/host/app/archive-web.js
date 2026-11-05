import {faceEditorAsset} from 'archive-face-editor-assets';
import {ActionButton} from 'ui-controls';
import Timer from 'timer';
import {Container,Label,Text,Skin,Style} from 'piu/MC';
import QRCode from 'piu/QRCode';
import {uiFont} from 'ui-theme';
import {HttpServerService,Response} from 'http-server-service';
import ArchiveHTTPServer from 'archive-http-server';
import {getSettingsStatus,openSettings} from 'archive-settings';
import PAGE from 'archive-web-page';
let robot,actions,access,server,lastStartError=false,screenMode='lan',screenQR='waiting';
const mediaName=name=>typeof name==='string'&&/^[a-z0-9-]+\.(bmp|avi|wav|jpg|json)$/.test(name);
export function controlStatus(){const s=getSettingsStatus();return {ready:!!server,ip:s.connected?s.ip:s.setupIP||'',lanIP:s.connected?s.ip:'',apIP:s.setupIP||'',port:8082,lan:s.connected,ap:s.setupActive,screenMode,screenQR};}
export function openControl(mode){
  robot.ui.application.behavior.closeDrawer?.();
  if(!robot.ui.application.behavior.launchMiniApp(mode==='ap'?'archive-control-ap':'archive-control'))throw new Error('Control QR unavailable');
  return controlStatus();
}
function authorized(c){return c.req.header('authorization')==='Bearer '+access||c.req.query('k')===access||(c.req.header('cookie')||'').split(';').some(v=>v.trim()==='sc_device='+access);}
function protect(handler){return async c=>{
  c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');c.header('X-Frame-Options','DENY');
  if(!authorized(c))return c.json({error:'本体の「スマホ操作」QRを読み取ってください。'},401);
  const origin=c.req.header('origin');if(origin&&origin.replace(/:80$/,'')!==('http://'+c.req.header('host')).replace(/:80$/,''))return c.json({error:'Invalid origin'},403);
  try{return await handler(c);}catch(error){trace('[control] request failed: '+String(error?.name||'Error')+'\n');return c.json({error:String(error.message||'本体で処理できませんでした')},503);}
};}
function startServer(){
  server=new HttpServerService({server:ArchiveHTTPServer,port:8082,maxRequestBodyBytes:20000});
  server.get('/',protect(c=>{c.header('Set-Cookie','sc_device='+access+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400');return new Response(PAGE,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Set-Cookie':'sc_device='+access+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400'}});}));
  for(const [path,name,type] of [['/face-editor','page','text/html'],['/face-editor.js','script','text/javascript'],['/face-format.js','format','text/javascript']])server.get(path,protect(()=>new Response(faceEditorAsset(name),{headers:{'Content-Type':type+'; charset=utf-8'}})));
  server.post('/rpc',protect(async c=>{const request=await c.req.json();if(!request||typeof request.op!=='string'||request.op.length>64||request.args!==undefined&&(!request.args||typeof request.args!=='object'||Array.isArray(request.args)))return c.json({error:'Invalid command'},400);return c.json(await actions.execute({op:request.op,args:request.args||{}}));}));
  server.get('/status',protect(async c=>c.json(await actions.execute({op:'/status',args:{}}))));
  // Explicitly authenticated, read-only, bounded metrics; no raw logs or secrets.
  server.get('/diagnostics',protect(async c=>c.json(await actions.execute({op:'/diagnostics/status',args:{}}))));
  server.get('/files',protect(async c=>c.json(await actions.execute({op:'/files',args:{}}))));
  server.get('/file',protect(c=>{const name=c.req.query('name'),offset=Number(c.req.query('offset')||0),length=Number(c.req.query('length')||32768);if(!mediaName(name)||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(length)||length<1||length>32768)return c.json({error:'Invalid range'},400);return new Response(actions.read(name,offset,length),{headers:{'Content-Type':'application/octet-stream'}});}));
  server.get('/media',protect(c=>{const name=c.req.query('name');if(!mediaName(name))return c.json({error:'Invalid file'},400);const data=actions.read(name,0,2*1024*1024,true);const type=name.endsWith('.bmp')?'image/bmp':name.endsWith('.jpg')?'image/jpeg':name.endsWith('.wav')?'audio/wav':name.endsWith('.avi')?'video/x-msvideo':'application/json';return new Response(data,{headers:{'Content-Type':type,'Content-Length':String(data.byteLength),'Cache-Control':'no-store'}});}));
  server.get('/monitor/audio',protect(c=>new Response(actions.monitorAudio(c.req.query('session')),{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}})));
  server.get('/camera/frame',protect(async c=>new Response(await actions.preview(c.req.query('session')),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store'}})));
  server.get('/messages',protect(c=>c.json(actions.messages())));
  for(const op of ['photo','record','audio'])server.post('/'+op,protect(async c=>c.json(await actions.execute({op:'/'+op,args:{}}))));
  trace('[control] device web server ready on 8082\n');
}
export function startWeb(context,callbacks,token){
  robot=context;actions=callbacks;access=token;
  function createControlScreen(mode,anchor=''){
    screenMode=mode;screenQR='waiting';const session=mode==='ap'?openSettings(true):undefined;
    const root=new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'})});
    const style=new Style({font:uiFont(),color:'black',horizontal:'left',vertical:'middle'});let previous='';
    function render(){const status=controlStatus(),host=mode==='ap'?status.apIP:status.lanIP,signature=host+':'+status.ready;if(signature===previous)return;previous=signature;root.empty();
      if(!host||!status.ready){screenQR='waiting';root.add(new Text(null,{left:16,right:16,top:12,bottom:12,style,string:mode==='lan'?'LAN接続を待っています。\n普段のWi-Fiに接続すると操作QRを表示します。\n\n設定用Wi-Fiへは自動で切り替えません。':'設定用Wi-Fiの起動を待っています。'}));return;}
      const url='http://'+host+':8082/?k='+access+anchor;screenQR=mode;
      if(session){root.add(new Label(null,{left:12,top:0,width:144,height:22,style,string:'1. 本体へ接続'}));root.add(new Label(null,{right:12,top:0,width:144,height:22,style,string:'2. 操作画面'}));root.add(new QRCode(null,{left:12,top:25,width:128,height:128,skin:{fill:'white',stroke:'black'},string:session.wifiQR,maxVersion:10}));root.add(new QRCode(null,{right:12,top:25,width:128,height:128,skin:{fill:'white',stroke:'black'},string:url,maxVersion:10}));root.add(new Label(null,{left:4,right:4,top:160,height:28,style,string:'インターネットなしでも接続を維持'}));}
      else{root.add(new QRCode(null,{left:12,top:20,width:144,height:144,skin:{fill:'white',stroke:'black'},string:url,maxVersion:10}));root.add(new Text(null,{left:168,right:8,top:24,bottom:8,style,string:(anchor?'AIの設定':'スマホで操作')+'\n同じWi-FiのスマホでQRを開いてください。\n\nhttp://'+host+':8082/'}));}
    }
    render();const timer=Timer.repeat(render,1000);return {content:root,dispose(){Timer.clear(timer);}};
  }
  robot.ui.miniApps.register({id:'archive-control',title:'スマホで操作',hidden:true,create:()=>createControlScreen('lan')});
  robot.ui.miniApps.register({id:'archive-ai-setup',title:'スマホでAIを設定',hidden:true,create:()=>createControlScreen('lan','#conversation')});
  robot.ui.miniApps.register({id:'archive-control-ap',title:'本体へ直接接続',hidden:true,create:()=>createControlScreen('ap')});
  robot.ui.miniApps.register({id:'archive-network-settings',title:'接続設定',hidden:true,create(){
    const style=new Style({font:uiFont(),color:'black',horizontal:'left',vertical:'middle'}),summary=new Text(null,{left:12,right:12,top:0,height:26,style,string:''});
    const update=()=>{const status=getSettingsStatus();summary.string=status.connected?'接続済み / '+status.ip:status.setupActive?'本体のWi-Fiを公開中':'Wi-Fi 未接続';};update();const timer=Timer.repeat(update,2000);
    const launch=id=>{actions.closeOffline?.();return robot.ui.application.behavior.launchMiniApp(id);};
    return {content:new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'}),contents:[summary,
      new ActionButton({label:'Wi-Fiを設定',onTap:()=>launch('wifi-settings')},{left:8,right:8,top:28,height:34}),
      new ActionButton({label:'スマホで操作（同じWi-Fi）',onTap:()=>openControl('lan')},{left:8,right:8,top:66,height:34}),
      new ActionButton({label:'本体に直接つないで操作',onTap:()=>openControl('ap')},{left:8,right:8,top:104,height:34}),
      new ActionButton({label:'接続状態',onTap:()=>launch('archive-wifi-status')},{left:8,right:8,top:142,height:34})
    ]}),dispose(){Timer.clear(timer);}};
  }});
  const launch=id=>{actions.closeOffline?.();return robot.ui.application.behavior.launchMiniApp(id);};
  function page(title,items){
    return {content:new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'}),contents:[
      new Label(null,{left:8,right:8,top:0,height:28,style:new Style({font:uiFont(),color:'black'}),string:title}),
      ...items.map(([label,onTap],i)=>new ActionButton({label,onTap},{left:8,right:8,top:30+i*36,height:32}))
    ]})};
  }
  robot.ui.miniApps.register({id:'archive-settings',title:'設定',create(){
    const result=page('設定',[]),root=result.content;
    for(const [i,[label,id]] of [['会話・AI','archive-chat-settings'],['音量・アラーム','archive-sound-settings'],['Wi-Fi・接続','archive-network-settings'],['オフライン','archive-offline-settings']].entries())
      root.add(new ActionButton({label,onTap:()=>launch(id)},{left:i%2?164:8,top:34+Math.floor(i/2)*44,width:148,height:38}));
    root.add(new ActionButton({label:'情報取得',onTap:()=>launch('archive-device-info')},{left:8,top:126,width:148,height:38}));
    root.add(new ActionButton({label:'動作確認',onTap:()=>launch('archive-checks')},{right:8,top:126,width:148,height:38}));
    root.add(new ActionButton({label:'起動設定',onTap:()=>launch('archive-boot-settings')},{left:8,right:8,top:168,height:26}));
    return result;
  }});
  robot.ui.miniApps.register({id:'archive-boot-settings',title:'起動設定',hidden:true,create:()=>page('起動時に「スタックチャン」と読み上げる',[
    ['読み上げ: '+(actions.bootSpeech?.()?'ON':'OFF'),()=>{actions.bootSpeech?.(!actions.bootSpeech?.());launch('archive-boot-settings');}]
  ])});
  robot.ui.miniApps.register({id:'archive-device-info',title:'情報取得',hidden:true,create(){
    let tab=0;
    const style=new Style({font:uiFont(),color:'black',horizontal:'left',vertical:'top'});
    const text=new Text(null,{left:10,right:10,top:4,height:130,style,string:''});
    const refresh=()=>{
      try{
        const d=actions.diagnostics(),w=d.wifi,a=d.ai;
        const states={off:'停止',identity:'話す人を選択待ち',waiting:'待機',connecting:'接続中',listening:'聞き取り中',speaking:'返答中',retrying:'再接続待ち',unconfigured:'未設定'};
        text.string=tab===0?'Wi-Fi・USB\nWi-Fi: '+(w.connected?'接続済み':'未接続')+'\nIP: '+(w.ip||'なし')+'\n強度: '+(d.signal.rssi===null?'取得不可':d.signal.rssi+' dBm / '+d.signal.bars+'/5')+'\nUSB: '+(d.connection.usb?'PC接続':'PC未接続')+' / 自動OFFLINE '+(d.connection.enabled?'ON':'OFF'):
          tab===1?'AI: '+a.provider+'\n設定: '+(a.configured?'登録済み':'未設定')+' / 会話 '+(a.enabled?'ON':'OFF')+'\n接続: '+(states[a.state]||'状態不明')+'\nエラー: '+(a.error?'あり（ログを確認）':'なし')+'\n'+(a.model||'XiaoZhiの設定モデル'):
          '音声・本体\n音量: '+d.volume.percent+'%\nマイク: '+(a.state==='listening'?'聞き取り中':'待機・停止')+' / 再生: '+(d.local.playing||a.state==='speaking'?'再生中':'停止')+'\n入力 '+a.audio.inputEvents+'回 / 出力 '+a.audio.outputEvents+'回\n時計: '+(d.clock.ready?'設定済み':'未設定');
      }catch(_){text.string='情報を取得できませんでした。\nもう一度「再取得」を押してください。';}
    };
    const root=new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'}),contents:[text,
      new ActionButton({label:'再取得',onTap:refresh},{left:8,top:138,width:96,height:36}),
      new ActionButton({label:'次へ',onTap:()=>{tab=(tab+1)%3;refresh();}},{left:112,top:138,width:96,height:36}),
      new ActionButton({label:'戻る',onTap:()=>robot.ui.application.behavior.onMiniAppBack()},{right:8,top:138,width:96,height:36})
    ]});refresh();const timer=Timer.repeat(refresh,2000);return {content:root,dispose(){Timer.clear(timer);}};
  }});
  robot.ui.miniApps.register({id:'archive-chat-settings',title:'会話・AI',hidden:true,create:()=>page('会話・AI',[
    ['会話を開始・停止',()=>launch('conversation-mode')],['AIを選ぶ',()=>launch('archive-ai-settings')],
    ['話す人を選ぶ・登録',()=>launch('archive-speaker')],['スマホでAIを設定',()=>launch('archive-ai-setup')]
  ])});
  robot.ui.miniApps.register({id:'archive-sound-settings',title:'音量・アラーム',hidden:true,create:()=>page('音量・アラーム',[
    ['音量',()=>launch('archive-volume')],['タイマー',()=>launch('archive-timer')],
    ['アラーム',()=>launch('archive-alarm')],['予約一覧・解除',()=>launch('archive-alarm-list')]
  ])});
  robot.ui.miniApps.register({id:'archive-offline-settings',title:'オフライン',hidden:true,create(){
    const view=page('オフライン',[
      ['USB・Wi-Fiなしで自動: '+(actions.autoOffline().enabled?'ON':'OFF'),()=>{actions.autoOffline(!actions.autoOffline().enabled);launch('archive-offline-settings');}],
      ['本体のボタンで操作',()=>actions.openOffline()],['日時を合わせる',()=>launch('archive-local-clock')]
    ]);return view;
  }});
  for(const key of ['archiveVolume','directChatMode','offlineMode','alarmSettings','toggleFace','cycleEmotion','toggleSpeech','speakStackchan','handAnimation','cameraPreview','toggleLookAround','servoTest','toggleLED','playTone','recordPlayback','toggleColor'])robot.drawer.removeDrawerButton(key);
  robot.drawer.addDrawerButton({key:'networkSettings',label:'設定',callback:()=>{robot.ui.application.behavior.closeDrawer?.();launch('archive-settings');}});
  Timer.repeat(()=>{if(server)return;const s=getSettingsStatus();if(!s.connected&&!s.setupActive)return;try{startServer();lastStartError=false;}catch(error){if(!lastStartError){trace('[control] web start failed: '+String(error?.name||'Error')+'\n');lastStartError=true;}}},1000);
}
