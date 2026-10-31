// AP provisioning follows Moddable's webConfigWifi and 78/esp-wifi-connect.
import WiFi from 'wifi';
import {Request as HttpRequest} from 'http';
import ArchiveHTTPServer from 'archive-http-server';
import Net from 'net';
import Timer from 'timer';
import Time from 'time';
import SNTP from 'sntp';
import QRCode from 'piu/QRCode';
import {Container,Label,Text,Skin,Style} from 'piu/MC';
import {ActionButton} from 'ui-controls';
import {uiFont} from 'ui-theme';
import {HttpServerService,Response} from 'http-server-service';
import {getSettings,changeSettings,vaultStatus,vaultSelfTest,randomHex} from 'archive-vault';

let robot,monitor,server,expiry,connectionTimeout,ntp,reconnectTimer;
let reconnectDelay=3000;
function scheduleReconnect(){if(reconnectTimer||!getSettings().wifi?.ssid)return;const delay=reconnectDelay;reconnectDelay=Math.min(60000,reconnectDelay*2);reconnectTimer=Timer.set(()=>{reconnectTimer=undefined;if(!connected&&connection!=='connecting')connectSaved();},delay);}
export function reconnectSavedWiFi(){connectSaved();return getSettingsStatus();}
let active=false,ssid='',password='',key='',connected=false,connection='offline',error='';
let httpRequests=0,lastHttpStatus=0,lastDisconnectReason;
let httpConnections=0,httpHeaders=0,httpErrors=0;
let apClients=0,apJoinCount=0,apLastJoined=null,setupDeadline=0;
const address='http://192.168.4.1/';
const byteLength=value=>ArrayBuffer.fromString(value).byteLength;
const PAGE=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StackChan 設定</title><style>body{font:16px system-ui;background:#f5f4ee;color:#193b3a;margin:0}main{max-width:480px;padding:24px;margin:auto}form{background:white;padding:20px;border-radius:18px}label{display:block;margin:16px 0 5px}input,select,button{font:inherit;box-sizing:border-box;padding:12px;width:100%;border:1px solid #b9cbc2;border-radius:10px}button{background:#1e6359;color:white;margin-top:14px}small{display:block;color:#526c67;margin-top:8px}#message{white-space:pre-wrap}h1{font-size:24px}</style><main><h1>StackChan 設定</h1><p>2.4 GHzのWi-Fiを登録します。設定は本体のSDに暗号化して保存します。</p><form id="settings"><label>Wi-Fi名（SSID）</label><input id="ssid" maxlength="32" autocomplete="off"><button type="button" id="scan">近くのWi-Fiを探す</button><select id="networks"><option value="">手入力、または一覧から選択</option></select><label>Wi-Fiパスワード</label><input id="password" type="password" maxlength="64" autocomplete="new-password"><small>保存済みと同じSSIDで空欄の場合は、現在のパスワードを維持します。</small><label>会話サービス</label><select id="provider"><option value="xiaozhi">XiaoZhi</option><option value="gemini">Gemini Live</option><option value="ollama">Ollama Cloud</option></select><small>GeminiとOllama Cloudの音声会話では、音声をGoogleへ送信します。Ollama Cloudは返答生成に使うため両方のキーが必要です。</small><label>APIサービス名（任意）</label><input id="apiName" placeholder="Gemini: gemini ／ Ollama Cloud: ollama" maxlength="32" autocomplete="off"><label>APIトークン（任意）</label><input id="apiToken" type="password" maxlength="4096" autocomplete="off"><small>トークンを登録しない場合は空欄にしてください。保存済みの秘密値は表示しません。</small><button id="save">保存してWi-Fiに接続</button></form><p id="message" role="status"></p><p id="scanMessage" role="status"></p><button id="finish">設定を終了</button><small>設定用Wi-Fiは「設定を終了」または30分で終了します。インターネット未接続の警告が出ても、この設定用Wi-Fiへの接続を維持してください。</small></main><script>
const key=new URL(location.href).searchParams.get('k');const el=id=>document.getElementById(id);
async function api(path,data){const response=await fetch(path+'?k='+encodeURIComponent(key),data?{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Key':key},body:JSON.stringify(data)}:{});const result=await response.json();if(!response.ok)throw Error(result.error||'設定できませんでした');return result;}
let initial=false;
async function status(){try{const s=await api('/status');if(!initial){el('ssid').value=s.ssid||'';el('provider').value=s.provider||'xiaozhi';initial=true;}el('message').textContent=(s.connected?'Wi-Fiに接続しました: '+s.ip:s.connection==='connecting'?'Wi-Fiに接続中です…':s.error||'Wi-FiとAPIを設定してください。')+'\\n登録済みAPI: '+(s.apiNames.join(', ')||'なし');}catch(e){el('message').textContent=e.message;}}
el('scan').onclick=async()=>{try{el('scan').disabled=true;el('scanMessage').textContent='Wi-Fiを検索しています…';const rows=await api('/scan');el('scanMessage').textContent=rows.length+'件見つかりました。一覧から選んでください。';el('networks').replaceChildren(new Option('一覧からWi-Fiを選んでください',''));for(const row of rows)el('networks').add(new Option(row.ssid+' ('+row.rssi+' dBm)',row.ssid));}catch(e){el('scanMessage').textContent=e.message;}finally{el('scan').disabled=false;}};
el('networks').onchange=()=>{if(el('networks').value)el('ssid').value=el('networks').value;};
el('settings').onsubmit=async event=>{event.preventDefault();el('save').disabled=true;try{await api('/save',{ssid:el('ssid').value,password:el('password').value,apiName:el('apiName').value,apiToken:el('apiToken').value,provider:el('provider').value});el('password').value='';el('apiToken').value='';el('message').textContent='SDに暗号化して保存しました。接続を確認しています…';}catch(e){el('message').textContent=e.message;}finally{el('save').disabled=false;}};
el('finish').onclick=async()=>{try{await api('/finish',{});el('message').textContent='設定を終了しました。スマホを普段のWi-Fiへ戻してください。';}catch(e){el('message').textContent=e.message;}};
status();setInterval(status,2500);
</script></html>`;

function ensureMonitor(){
  if(monitor)return;
  monitor=new WiFi(null,(message,reason)=>{
    if(message==='station_connect'){apClients++;apJoinCount++;apLastJoined=Date.now();trace('[settings] AP client joined; clients='+apClients+'\n');return;}
    if(message==='station_disconnect'){apClients=Math.max(0,apClients-1);trace('[settings] AP client left; clients='+apClients+'\n');return;}
    if(message===WiFi.gotIP){
      connected=true;connection='connected';error='';reconnectDelay=3000;if(reconnectTimer){Timer.clear(reconnectTimer);reconnectTimer=undefined;}
      if(connectionTimeout){Timer.clear(connectionTimeout);connectionTimeout=undefined;}
      trace('[settings] Wi-Fi connected\n');
      try{ntp?.close();ntp=new SNTP({host:'pool.ntp.org'},(message,value)=>{if(message===SNTP.time){Time.set(value);trace('[settings] network clock synchronized\n');}});}catch(_){}
    }else if(message===WiFi.disconnected||message===WiFi.lostIP){connected=false;lastDisconnectReason=Number.isInteger(reason)?reason:undefined;if(connection!=='connecting')connection='offline';if(lastDisconnectReason!==undefined)trace('[settings] Wi-Fi disconnected reason='+lastDisconnectReason+'\n');scheduleReconnect();}
  });
}
function connectSaved(){
  const wifi=getSettings().wifi;if(!wifi?.ssid)return;
  if(reconnectTimer){Timer.clear(reconnectTimer);reconnectTimer=undefined;}
  ensureMonitor();connected=false;connection='connecting';error='';
  if(connectionTimeout)Timer.clear(connectionTimeout);
  connectionTimeout=Timer.set(()=>{connectionTimeout=undefined;if(!connected){connection='failed';error='Wi-Fiに接続できません。SSID・パスワード・2.4 GHzを確認してください。';trace('[settings] Wi-Fi connection failed\n');scheduleReconnect();}},25000);
  try{if(active)WiFi.mode=WiFi.Mode.station|WiFi.Mode.accessPoint;WiFi.connect({ssid:wifi.ssid,password:wifi.password});}catch(_){connection='failed';error='Wi-Fiに接続できません。設定を確認してください。';scheduleReconnect();}
}
export function getSettingsStatus(){return {...vaultStatus(),setupActive:active,setupIP:active?(Net.get('IP','ap')??''):'',setupMode:active?WiFi.mode:0,connected,connection,error,provider:getSettings().conversationProvider||'xiaozhi',geminiConfigured:!!getSettings().api?.gemini,ip:connected?(Net.get('IP')??''):'',clockReady:Date.now()>1700000000000,httpRequests,lastHttpStatus,lastDisconnectReason,httpConnections,httpHeaders,httpErrors,apClients,apJoinCount,apLastJoined,setupSecondsRemaining:active?Math.max(0,Math.ceil((setupDeadline-Date.now())/1000)):0};}
export function closeSettings(){
  if(!active)return;
  active=false;apClients=0;setupDeadline=0;server?.close();server=undefined;
  if(expiry)Timer.clear(expiry);expiry=undefined;key='';password='';
  try{if(getSettings().wifi?.ssid){WiFi.mode=WiFi.Mode.station;connectSaved();}else{monitor?.close();monitor=undefined;WiFi.mode=WiFi.Mode.none;}}catch(_){trace('[settings] AP cleanup failed\n');}
  trace('[settings] setup access point closed\n');
}
let scanning=false;
export async function scanNearby(){
  if(scanning)throw new Error('Scan already running');
  scanning=true;
  try{
    if(active)WiFi.mode=WiFi.Mode.station|WiFi.Mode.accessPoint;
    await new Promise(resolve=>Timer.set(resolve,200));
    return await new Promise((resolve,reject)=>{
      const rows=[];let finished=false;
      const done=(failed)=>{if(finished)return;finished=true;Timer.clear(timeout);if(failed){trace('[settings] Wi-Fi scan failed\n');reject(new Error('Scan failed'));}else{trace('[settings] Wi-Fi scan complete; count='+rows.length+'\n');resolve(rows.sort((a,b)=>b.rssi-a.rssi));}};
      const timeout=Timer.set(()=>done(true),8000);
      try{WiFi.scan({},ap=>{if(!ap){done(false);return;}if(ap.ssid&&rows.length<32&&!rows.some(row=>row.ssid===ap.ssid))rows.push({ssid:ap.ssid,rssi:ap.rssi});});}catch(_){done(true);}
    });
  }finally{scanning=false;}
}
function protect(handler){return async c=>{
  httpRequests++;
  if(c.req.path==='/')trace('[settings] HTTP settings page reached\n');
  c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');c.header('X-Frame-Options','DENY');
  if(!active||(c.req.query('k')??c.req.header('x-setup-key'))!==key){lastHttpStatus=401;return c.json({error:'本体に表示した設定ページのQRを読み取ってください。'},401);}
  const origin=c.req.header('origin');if(origin&&origin.replace(/:80$/,'')!==('http://'+c.req.header('host')).replace(/:80$/,'')){lastHttpStatus=403;return c.json({error:'設定ページを本体のQRから開き直してください。'},403);}
  try{const result=await handler(c);lastHttpStatus=result.status??200;return result;}catch(_){lastHttpStatus=400;error='保存できませんでした。Wi-Fi名・パスワードの文字数とSDカードを確認してください。';trace('[settings] settings request failed\n');return c.json({error},400);}
};}
export function openSettings(keepStation=false){
  if(active){if(keepStation&&!connected&&getSettings().wifi?.ssid)Timer.set(connectSaved,300);return {...getSettingsStatus(),wifiQR:`WIFI:T:WPA;S:${ssid};P:${password};;`,pageQR:address+'?k='+key};}
  ensureMonitor();ssid='StackChan-'+String(Net.get('MAC')??'5AD0').replace(/:/g,'').slice(-4).toUpperCase();
  password=randomHex().slice(0,12);key=randomHex();ssid+='-'+key.slice(0,4).toUpperCase();
  apClients=0;setupDeadline=Date.now()+1800000;
  WiFi.mode=WiFi.Mode.accessPoint;
  WiFi.accessPoint({ssid,password,station:false});active=true;
  server=new HttpServerService({server:ArchiveHTTPServer,port:80,maxRequestBodyBytes:8192,onDiagnostic:event=>{
    if(event==='tcp-open')httpConnections++;
    if(event==='http-headers')httpHeaders++;
    if(event==='tcp-error'||event.startsWith('response-error:'))httpErrors++;
    trace('[settings-http] '+event+'\n');
  }});
  server.get('/',protect(c=>new Response(PAGE,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'}})));
  server.get('/status',protect(c=>c.json(getSettingsStatus())));
  server.get('/scan',protect(async c=>{try{return c.json(await scanNearby());}catch(_){return c.json({error:'Wi-Fi検索に失敗しました。もう一度試すか、SSIDを手入力してください。'},503);}}));
  server.post('/save',protect(async c=>{
    const body=await c.req.json();
    const name=String(body.ssid??''),pass=String(body.password??'');
    const apiName=String(body.apiName??'').trim(),apiToken=String(body.apiToken??'');
    if(body.provider!==undefined&&!['gemini','xiaozhi','ollama'].includes(body.provider))throw new Error('provider');
    if(byteLength(name)>32||byteLength(pass)>64||(pass&&byteLength(pass)<8)||(byteLength(pass)===64&&!/^[a-fA-F0-9]{64}$/.test(pass)))throw new Error('wifi');
    if(apiToken&&(!/^[a-z][a-z0-9_-]{0,31}$/.test(apiName)||['constructor','prototype'].includes(apiName)||apiToken.length>4096))throw new Error('api');
    if(!name&&!apiToken&&body.provider===undefined)throw new Error('empty');
    changeSettings(data=>{
      if(body.provider!==undefined)data.conversationProvider=body.provider;
      if(name)data.wifi={ssid:name,password:!pass&&data.wifi?.ssid===name?data.wifi.password:pass};
      if(apiToken){if(!Object.hasOwn(data.api,apiName)&&Object.keys(data.api).length>=8)throw new Error('limit');data.api[apiName]=apiToken.trim();}
    });
    trace('[settings] encrypted configuration saved to SD\n');
    if(name)Timer.set(connectSaved,500);
    return c.json({saved:true,encrypted:true});
  }));
  server.post('/finish',protect(c=>{Timer.set(()=>{closeSettings();robot.ui.showFace();},500);return c.json({ok:true});}));
  expiry=Timer.set(()=>{closeSettings();robot.ui.showFace();},1800000);
  if(keepStation&&getSettings().wifi?.ssid)Timer.set(connectSaved,300);
  trace('[settings] setup AP and local settings server started\n');
  return {...getSettingsStatus(),wifiQR:`WIFI:T:WPA;S:${ssid};P:${password};;`,pageQR:address+'?k='+key};
}
export function settingsHttpSelfTest(){
  if(!active)return Promise.resolve({error:'Setup AP is closed'});
  return new Promise(resolve=>{
    let request,status=0,finished=false;
    const finish=result=>{if(finished)return;finished=true;Timer.clear(timeout);try{request?.close();}catch(_){}resolve(result);};
    const timeout=Timer.set(()=>finish({status,error:'Local settings HTTP timed out',httpRequests}),12000);
    try{
      request=new HttpRequest({host:'192.168.4.1',port:80,path:'/?k='+key,response:String});
      request.callback=(message,value)=>{
        if(message===HttpRequest.status)status=value;
        else if(message===HttpRequest.responseComplete)finish({status,html:typeof value==='string'&&value.includes('StackChan'),bytes:typeof value==='string'?value.length:0,httpRequests});
        else if(message<0)finish({status,error:'Local settings HTTP connection failed',httpRequests});
      };
    }catch(_){finish({status,error:'Local HTTP client unavailable',httpRequests});}
  });
}
function createScreen(context){
  const session=openSettings(),styles={compact:new Style({font:uiFont(),color:'black',horizontal:'left',vertical:'middle'})};
  const first=new QRCode(null,{left:12,top:23,width:128,height:128,skin:{fill:'white',stroke:'black'},string:session.wifiQR,maxVersion:10});
  const second=new QRCode(null,{right:12,top:23,width:128,height:128,skin:{fill:'white',stroke:'black'},string:session.pageQR,maxVersion:10});
  return {content:new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'}),contents:[
    new Label(null,{left:4,top:0,width:148,height:23,style:styles.compact,string:'1. Wi-Fiへ接続'}),
    new Label(null,{right:4,top:0,width:148,height:23,style:styles.compact,string:'2. 設定ページ'}),first,second,
    new Text(null,{left:8,right:8,top:153,bottom:0,style:styles.compact,string:'1 接続（ネットなしでOK）→ 2 開く\nWi-Fiを入力し保存。HTTP: 192.168.4.1'})
  ]})};
}
export function startSettings(context){
  robot=context;
  try{getSettings();if(getSettings().wifi?.ssid)connectSaved();}catch(_){trace('[settings] SD configuration unavailable\n');}
  robot.ui.miniApps.register({id:'wifi-settings',hidden:true,title:'Wi-Fi / API設定',create:createScreen});
}
export {vaultSelfTest};
