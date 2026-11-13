import Net from 'net';
import Timer from 'timer';
import {Container,Text,Skin,Style} from 'piu/MC';
import {uiFont} from 'ui-theme';
import {getSettingsStatus} from 'archive-settings';
let currentRobot,lastSignal={rssi:null,bars:0};
export function wifiSignal(connected){let rssi;try{rssi=connected?Net.get('RSSI'):undefined;}catch(_){}if(!Number.isFinite(rssi)||rssi>0||rssi< -127)return {rssi:null,bars:0};return {rssi,bars:rssi>=-55?5:rssi>=-65?4:rssi>=-72?3:rssi>=-80?2:1};}
export function wifiDisplayStatus(){const result={...lastSignal};currentRobot?.ui.application.distribute('onWiFiConnectionStatus',result);return result;}
export function wifiLabel(s){return s.connected?'Wi-Fi 接続':s.connection==='connecting'?'Wi-Fi 接続中':s.setupActive?'設定用Wi-Fi':'Wi-Fi 未接続';}
export function startWiFiDisplay(robot){
 currentRobot=robot;
 const update=()=>{const s=getSettingsStatus();lastSignal=wifiSignal(s.connected);robot.ui.miniApps.refreshAvailability?.();robot.ui.application.distribute('onWiFiConnection',{label:'WiFi '+(s.connected?lastSignal.bars:0),color:s.connected?'#167647':s.connection==='connecting'?'#986400':s.setupActive?'#1768a6':'#b52b2b'});};
 Timer.set(update,0);Timer.repeat(update,2000);
 robot.ui.miniApps.register({id:'archive-wifi-status',hidden:true,title:'Wi-Fi接続',create(){const view=new Text(null,{left:10,right:10,top:8,bottom:8,style:new Style({font:uiFont(),color:'black',horizontal:'left',vertical:'top'}),string:''});const refresh=()=>{const s=getSettingsStatus(),signal=wifiSignal(s.connected);view.string=wifiLabel(s)+'\n\nSSID: '+(s.ssid||'—')+'\nIP: '+(s.ip||s.setupIP||'—')+'\n強度: '+(signal.rssi===null?'—':signal.rssi+' dBm ('+signal.bars+'/5)')+'\n\nクラウドAIにはインターネット接続が必要です。';};refresh();const timer=Timer.repeat(refresh,2000);return {content:new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'}),contents:[view]}),dispose(){Timer.clear(timer);}};}});
}
