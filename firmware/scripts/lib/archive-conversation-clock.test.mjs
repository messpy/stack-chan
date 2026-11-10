import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'

const text=readFileSync(new URL('../../host/app/archive-conversation-clock.js',import.meta.url),'utf8').replace(/^export /gm,'')
const context=vm.createContext({Date,Math,Number,String,JSON})
vm.runInContext(text+'\nthis.api={conversationClockContext,conversationClockInstruction}',context)
const {conversationClockContext,conversationClockInstruction}=context.api
test('evening UTC is rendered as Japanese next-day early morning',()=>{
 const date=Date.UTC(2026,10,7,23,15,0);
 const x=conversationClockContext(date,540);
 assert.equal(x.localTime,'2026-11-08T08:15:00+09:00');
 assert.equal(x.period,'朝');
 assert.equal(x.timezone,'Asia/Tokyo');
});
test('Japan evening stays evening instead of UTC morning',()=>{
 const date=Date.UTC(2026,10,8,11,12,13);
 const x=conversationClockContext(date,540);
 assert.equal(x.localTime,'2026-11-08T20:12:13+09:00');
 assert.equal(x.period,'夜');
 assert.match(conversationClockInstruction(date,540),/20:12:13\+09:00/);
});
test('unknown timezone or invalid clock never yields a guessed greeting',()=>{
 assert.equal(conversationClockContext(0,540).valid,false);
 assert.equal(conversationClockContext(Date.UTC(2026,10,8,2),NaN).valid,false);
 assert.match(conversationClockInstruction(0,540),/未確認/);
 assert.equal(conversationClockContext(Date.UTC(2026,10,8,12),0).timezone,'UTC+00:00');
});
