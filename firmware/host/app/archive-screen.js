import Timer from 'timer';
const install = native('xs_screen_capture_install');
const region = native('xs_screen_capture_region');
const request = native('xs_screen_capture_request');
const ready = native('xs_screen_capture_ready');
const complete = native('xs_screen_capture_complete');
const begin = native('xs_screen_capture_begin');
const read = native('xs_screen_capture_read');
export function installScreenCapture(){
  if(!globalThis.screen)throw new Error('Display unavailable');
  const screen=globalThis.screen;
  install(screen,screen.width,screen.height);
  const originalBegin=screen.begin;
  Object.defineProperty(screen,'begin',{configurable:true,value:function(x,y,w,h){region(x,y,w,h);return originalBegin.call(this,x,y,w,h);}});
  const originalEnd=screen.end;
  Object.defineProperty(screen,'end',{configurable:true,value:function(){const result=originalEnd.call(this);complete();return result;}});
  trace('[screen] display mirror enabled\n');
}
export function screenCommand(action,args={}){
  if(action==='begin')return begin();
  if(action==='read')return read(args.id,args.offset,args.length);
  throw new Error('Unknown screen command');
}
export function showScreen(robot,scene){
  const pages={settings:'archive-settings',checks:'archive-checks',info:'archive-device-info',volume:'archive-volume',ai:'archive-ai-settings',offline:'archive-offline-settings',network:'archive-network-settings',alarm:'archive-alarm'};
  robot.ui.closeDrawer();robot.hideBalloon();
  if(scene==='face'||scene==='balloon-test'){robot.ui.showFace();if(scene==='balloon-test')robot.showBalloon('画面表示の確認です。長い吹き出しでも、約5秒後に消えてボタンが見えるようになります。',{bottom:50});return {scene};}
  if(scene==='drawer'){robot.ui.showFace();robot.ui.openDrawer();return {scene};}
  if(!pages[scene])throw new Error('Unsupported screen');
  if(!robot.ui.application.behavior.launchMiniApp(pages[scene]))throw new Error('Screen unavailable');
  return {scene};
}

export async function captureFrame(robot){
  request();
  const app=robot.ui.application,previous=app.state;
  // Piu Content's public state setter invalidates its bounds; Application has no invalidate() method.
  app.state=previous===0?1:0;app.state=previous;
  for(let i=0;i<100;i++){
    if(ready())return begin();
    await new Promise(resolve=>Timer.set(resolve,10));
  }
  throw new Error('Screen redraw timed out');
}
