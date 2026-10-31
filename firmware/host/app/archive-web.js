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
  server.post('/rpc',protect(async c=>{const request=await c.req.json();if(!request||typeof request.op!=='string'||request.op.length>64||request.args!==undefined&&(!request.args||typeof request.args!=='object'||Array.isArray(request.args)))return c.json({error:'Invalid command'},400);return c.json(await actions.execute({op:request.op,args:request.args||{}}));}));
  server.get('/status',protect(async c=>c.json(await actions.execute({op:'/status',args:{}}))));
  server.get('/files',protect(async c=>c.json(await actions.execute({op:'/files',args:{}}))));
  server.get('/file',protect(c=>{const name=c.req.query('name'),offset=Number(c.req.query('offset')||0),length=Number(c.req.query('length')||32768);if(!mediaName(name)||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(length)||length<1||length>32768)return c.json({error:'Invalid range'},400);return new Response(actions.read(name,offset,length),{headers:{'Content-Type':'application/octet-stream'}});}));
  server.get('/media',protect(c=>{const name=c.req.query('name');if(!mediaName(name))return c.json({error:'Invalid file'},400);const data=actions.read(name,0,2*1024*1024,true);const type=name.endsWith('.bmp')?'image/bmp':name.endsWith('.jpg')?'image/jpeg':name.endsWith('.wav')?'audio/wav':name.endsWith('.avi')?'video/x-msvideo':'application/json';return new Response(data,{headers:{'Content-Type':type,'Content-Length':String(data.byteLength),'Cache-Control':'no-store'}});}));
  server.get('/messages',protect(c=>c.json(actions.messages())));
  for(const op of ['photo','record','audio'])server.post('/'+op,protect(async c=>c.json(await actions.execute({op:'/'+op,args:{}}))));
  trace('[control] device web server ready on 8082\n');
}
export function startWeb(context,callbacks,token){
  robot=context;actions=callbacks;access=token;
  function createControlScreen(mode){
    screenMode=mode;screenQR='waiting';const session=mode==='ap'?openSettings(true):undefined;
    const root=new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'})});
    const style=new Style({font:uiFont(),color:'black',horizontal:'left',vertical:'middle'});let previous='';
    function render(){const status=controlStatus(),host=mode==='ap'?status.apIP:status.lanIP,signature=host+':'+status.ready;if(signature===previous)return;previous=signature;root.empty();
      if(!host||!status.ready){screenQR='waiting';root.add(new Text(null,{left:16,right:16,top:12,bottom:12,style,string:mode==='lan'?'LAN接続を待っています。\n普段のWi-Fiに接続すると操作QRを表示します。\n\n設定用Wi-Fiへは自動で切り替えません。':'設定用Wi-Fiの起動を待っています。'}));return;}
      const url='http://'+host+':8082/?k='+access;screenQR=mode;
      if(session){root.add(new Label(null,{left:12,top:0,width:144,height:22,style,string:'1. Wi-Fi接続'}));root.add(new Label(null,{right:12,top:0,width:144,height:22,style,string:'2. 操作画面'}));root.add(new QRCode(null,{left:12,top:25,width:128,height:128,skin:{fill:'white',stroke:'black'},string:session.wifiQR,maxVersion:10}));root.add(new QRCode(null,{right:12,top:25,width:128,height:128,skin:{fill:'white',stroke:'black'},string:url,maxVersion:10}));root.add(new Label(null,{left:4,right:4,top:160,height:28,style,string:'インターネットなしでも接続を維持'}));}
      else{root.add(new QRCode(null,{left:12,top:20,width:144,height:144,skin:{fill:'white',stroke:'black'},string:url,maxVersion:10}));root.add(new Text(null,{left:168,right:8,top:24,bottom:8,style,string:'LAN操作\n同じWi-FiのスマホでQRを開いてください。\n\nhttp://'+host+':8082/'}));}
    }
    render();const timer=Timer.repeat(render,1000);return {content:root,dispose(){Timer.clear(timer);}};
  }
  robot.ui.miniApps.register({id:'archive-control',title:'LAN操作QR',hidden:true,create:()=>createControlScreen('lan')});
  robot.ui.miniApps.register({id:'archive-control-ap',title:'StackChan Wi-Fi操作',hidden:true,create:()=>createControlScreen('ap')});
  robot.ui.miniApps.register({id:'archive-network-settings',title:'接続設定',hidden:true,create(){
    const style=new Style({font:uiFont(),color:'black',horizontal:'left',vertical:'middle'}),summary=new Text(null,{left:12,right:12,top:0,height:26,style,string:''});
    const update=()=>{const status=getSettingsStatus();summary.string=status.connected?'Wi-Fi 接続済み / '+status.ip:'Wi-Fi 未接続';};update();const timer=Timer.repeat(update,2000);
    const launch=id=>robot.ui.application.behavior.launchMiniApp(id);
    return {content:new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'}),contents:[summary,
      new ActionButton({label:'同じWi-Fiから操作 / LAN QR',onTap:()=>openControl('lan')},{left:8,right:8,top:28,height:34}),
      new ActionButton({label:'StackChan Wi-Fiへ接続して操作',onTap:()=>openControl('ap')},{left:8,right:8,top:66,height:34}),
      new ActionButton({label:'Wi-Fi / API設定',onTap:()=>launch('wifi-settings')},{left:8,top:104,width:148,height:34}),
      new ActionButton({label:'接続状態・強度',onTap:()=>launch('archive-wifi-status')},{right:8,top:104,width:148,height:34}),
      new ActionButton({label:'AI選択',onTap:()=>launch('archive-ai-settings')},{left:8,top:142,width:148,height:34}),
      new ActionButton({label:'話す人を選択',onTap:()=>launch('archive-speaker')},{right:8,top:142,width:148,height:34})
    ]}),dispose(){Timer.clear(timer);}};
  }});
  robot.drawer.addDrawerButton({key:'networkSettings',label:'設定 / 接続・AI',callback:()=>{robot.ui.application.behavior.closeDrawer?.();robot.ui.application.behavior.launchMiniApp('archive-network-settings');}});
  Timer.repeat(()=>{if(server)return;const s=getSettingsStatus();if(!s.connected&&!s.setupActive)return;try{startServer();lastStartError=false;}catch(error){if(!lastStartError){trace('[control] web start failed: '+String(error?.name||'Error')+'\n');lastStartError=true;}}},1000);
}
