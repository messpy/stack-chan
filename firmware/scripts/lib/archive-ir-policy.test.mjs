import assert from 'node:assert/strict'
import {test} from 'node:test'
import {validateLearnedIR,resolveStrictVoiceIRCommand,canSendIR} from './archive-ir-policy.mjs'

const learned=Object.freeze({version:1,deviceId:'living-tv',buttonId:'power',deviceType:'tv',protocol:'NEC',address:0,command:16,carrierHz:38000,repeat:0});
test('only bounded learned signal schema is accepted',()=>{
 assert.equal(validateLearnedIR(learned).ok,true);
 assert.equal(validateLearnedIR({...learned,debug:'unexpected'}).ok,false);
 assert.equal(validateLearnedIR({...learned,deviceType:'security'}).ok,false);
 assert.equal(validateLearnedIR({...learned,carrierHz:0}).ok,false);
 assert.equal(validateLearnedIR({...learned,command:Infinity}).ok,false);
});
test('raw frames require even bounded timing list and budget',()=>{
 const raw={version:1,deviceId:'room-ac',buttonId:'off',deviceType:'aircon',protocol:'RAW',carrierHz:38000,repeat:0,timingsUs:[9000,4500,560,560]};
 assert.equal(validateLearnedIR(raw).ok,true);
 assert.equal(validateLearnedIR({...raw,timingsUs:[9000,4500,560]}).ok,false);
 assert.equal(validateLearnedIR({...raw,timingsUs:Array(1024).fill(20000)}).ok,false);
 assert.equal(validateLearnedIR({...raw,timingsUs:[1,5]}).ok,false);
});
test('only unique registered exact phrases route to IR',()=>{
 const reg=[{record:learned,phrases:['テレビの電源をつけて']}];
 assert.deepEqual(resolveStrictVoiceIRCommand('テレビの電源をつけて。',reg),{deviceId:'living-tv',buttonId:'power'});
 for(const sentence of ['テレビの電源をつけないで','テレビの電源をつけてくれる？','テレビの電源をつけてから他のことをして','照明をつけて']){
  assert.equal(resolveStrictVoiceIRCommand(sentence,reg),null);
 }
 assert.equal(resolveStrictVoiceIRCommand('テレビの電源をつけて',reg.concat(reg)),null);
});
test('invalid/too-rapid transmission requests are blocked',()=>{
 assert.equal(canSendIR(learned,1000,null),true);
 assert.equal(canSendIR(learned,1100,1000),false);
 assert.equal(canSendIR(learned,1500,1000),true);
 assert.equal(canSendIR({...learned,deviceId:'../escape'},1500,null),false);
});
