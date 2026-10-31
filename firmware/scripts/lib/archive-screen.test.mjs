import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
let coords,endCalls=0,invalidated=0,complete=false,beginCalls=0;
const screen={width:320,height:240,begin(...args){coords=args;},end(){endCalls++;}};
const hooks={xs_screen_capture_install(){return true;},xs_screen_capture_region(...args){coords=args;},xs_screen_capture_complete(){complete=true;},xs_screen_capture_request(){complete=false;},xs_screen_capture_ready(){return complete;},xs_screen_capture_begin(){beginCalls++;return {id:7};},xs_screen_capture_read(){return new ArrayBuffer(2);}};
const c=vm.createContext({native:name=>hooks[name],screen,trace(){},Timer:{set:fn=>{complete=true;fn();}}});
vm.runInContext(fs.readFileSync(new URL('../../host/app/archive-screen.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,''),c);
vm.runInContext('installScreenCapture()',c);screen.begin(3,4,5,6);assert.deepEqual(coords,[3,4,5,6]);screen.end();assert.equal(endCalls,1);
let state=0;c.robot={ui:{application:{get state(){return state;},set state(value){state=value;invalidated++;}}}};const result=await vm.runInContext('captureFrame(robot)',c);assert.equal(result.id,7);assert.equal(invalidated,2);assert.equal(state,0);assert.equal(beginCalls,1);
console.log('PASS: legacy draw dispatch is mirrored and screenshot waits for a requested redraw before snapshot metadata');
