import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const root=new URL('../../host/app/',import.meta.url);
const format=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('archive-face-format.js',root))).toString('base64'));
const original=format.faceTemplate();const valid=format.validateFace(original);assert.equal(valid.frames.neutral.length,3);
assert.equal(format.validateFace(format.faceTemplate('round')).frames.neutral[0].kind,'ellipse');
for(const bad of [{...original,frames:null},{...original,background:'url(x)'},{...original,version:2}])assert.throws(()=>format.validateFace(bad));
const outside=structuredClone(original);outside.frames.neutral[0].points[0][0]=999;assert.throws(()=>format.validateFace(outside));
const excessive=structuredClone(original);excessive.frames.neutral=Array(65).fill(original.frames.neutral[0]);assert.throws(()=>format.validateFace(excessive));
const mouthBounds=format.faceBounds(valid.frames.neutral,'mouth');const shut=format.faceTransform([115,144],'mouth',mouthBounds,{mouth:0}),open=format.faceTransform([115,144],'mouth',mouthBounds,{mouth:1});assert.ok(open[0]>shut[0]);assert.ok(open[1]<shut[1]);
const eyeBounds=format.faceBounds(valid.frames.neutral,'leftEye');const eyelid=format.faceTransform([82,85],'leftEye',eyeBounds,{left:0});assert.ok(eyelid[1]>85);
let settings={},saved=0,shown=[],traceLines=[];
class Node{constructor(data,options=data||{}){Object.assign(this,options);this.children=options.contents||[];if(options.Behavior){this.behavior=new options.Behavior();this.behavior.onCreate?.(this)}}}
class Path{moveTo(){}lineTo(){}closePath(){}}
const context=vm.createContext({...format,Container:Node,Skin:Node,Shape:Node,FaceBase:Node,SimpleFace:Node,Behavior:class{},Outline:{CanvasPath:Path,stroke:()=>({}),fill:()=>({}),LINECAP_ROUND:1,LINEJOIN_ROUND:0},getSettings:()=>settings,changeSettings:fn=>{fn(settings);saved++},trace:s=>traceLines.push(s)});
vm.runInContext(fs.readFileSync(new URL('archive-custom-face.js',root),'utf8').replace(/^import .*$/gm,'').replace(/export /g,''),context);
context.robotContext={ui:{setFace:face=>shown.push(face),showFace(){}}};vm.runInContext('startCustomFace(robotContext)',context);
context.design=valid;vm.runInContext("faceCommand('save',{face:design})",context);assert.equal(saved,1);assert.equal(settings.customFaceEnabled,true);assert.equal(shown.length,1);
const shape=shown[0].children[0].children[0];shape.behavior.onFaceState(shape,{emotion:0,eyes:{left:{open:1,gazeX:0,gazeY:0},right:{open:1,gazeX:0,gazeY:0}},mouth:{open:0}});assert.equal(shape.visible,true);
vm.runInContext("faceCommand('restore')",context);assert.equal(settings.customFaceEnabled,false);assert.ok(settings.customFace);
settings.customFaceEnabled=true;vm.runInContext('startCustomFace(robotContext)',context);assert.equal(traceLines.length,0);assert.equal(shown.length,3);
context.design=outside;const before=saved;assert.throws(()=>vm.runInContext("faceCommand('save',{face:design})",context));assert.equal(saved,before);
console.log('PASS: face template/validation, mouth and blink geometry, SD save/restore/reload, invalid design never persisted');
