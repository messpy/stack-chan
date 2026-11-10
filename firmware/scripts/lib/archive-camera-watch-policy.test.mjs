import assert from 'node:assert/strict'
import {test} from 'node:test'
import {rgb565ToGrayDownsample,compareGrayFrames,nextMotionAlert} from './archive-camera-watch-policy.mjs'

test('RGB565LE prototype downsamples to bounded grayscale',()=>{
 const bytes=new Uint8Array(8*8*2);bytes.fill(255);
 const {gray,width,height}=rgb565ToGrayDownsample(bytes,8,8,4);
 assert.equal(width,2);assert.equal(height,2);assert.equal(gray.length,4);
 assert.ok(gray.every(value=>value>=250));
 assert.throws(()=>rgb565ToGrayDownsample(new Uint8Array(1),8,8),/mismatch/);
})
test('identical images and global illumination shift are rejected',()=>{
 const previous=new Uint8Array(16*16).fill(80);
 const equal=compareGrayFrames(previous,previous,16,16);
 assert.equal(equal.motion,false);assert.equal(equal.ratio,0);
 const brighter=new Uint8Array(16*16).fill(110);
 const lit=compareGrayFrames(previous,brighter,16,16);
 assert.equal(lit.illuminationOffset,30);
 assert.equal(lit.motion,false);
})
test('local motion survives global lighting compensation',()=>{
 const previous=new Uint8Array(16*16).fill(80);
 const next=new Uint8Array(16*16).fill(100);
 for(let y=4;y<10;y++)for(let x=4;x<10;x++)next[y*16+x]=190;
 const result=compareGrayFrames(previous,next,16,16);
 assert.equal(result.illuminationOffset,20);
 assert.equal(result.changedPixels,36);
 assert.ok(result.motion);
 const roi=compareGrayFrames(previous,next,16,16,{roi:{x:0,y:0,width:4,height:4}});
 assert.equal(roi.changedPixels,0);
})
test('two hits required and cooldown limits repeat alerts',()=>{
 let state={hits:0,lastAlert:null};
 state=nextMotionAlert(state,0.15,1000);assert.equal(state.notify,false);
 state=nextMotionAlert(state,0.15,2000);assert.equal(state.notify,true);
 state=nextMotionAlert(state,0.15,3000);assert.equal(state.notify,false);
 state=nextMotionAlert(state,0.15,4000);assert.equal(state.notify,false);
 state=nextMotionAlert(state,0.15,302001);assert.equal(state.notify,true);
 state=nextMotionAlert(state,0,303000);assert.equal(state.hits,0);
})
