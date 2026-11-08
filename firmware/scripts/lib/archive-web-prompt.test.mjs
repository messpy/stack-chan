import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWebPrompt, createWebPromptController } from '../../host/app/archive-web-prompt.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}) {
  let released = 0, stored = 0, shown = 0;
  const actions = {
    provider: () => 'gemini',
    online: () => true,
    configured: () => true,
    reserve: () => {},
    current: () => true,
    ask: async () => 'こんにちは',
    save: () => { stored++; return true; },
    show: () => { shown++; return true; },
    release: () => { released++; },
    ...overrides,
  };
  return { api: createWebPromptController(actions), stats: () => ({ released, stored, shown }) };
}
test('UTF-8 limits, empty input, and invalid IDs', () => {
  assert.equal(validateWebPrompt({ text: '  こんにちは  ', requestId: 'web-test-01' }).text, 'こんにちは');
  assert.throws(() => validateWebPrompt({ text: ' ', requestId: 'web-test-01' }), /文章/);
  assert.throws(() => validateWebPrompt({ text: 'あ'.repeat(2001), requestId: 'web-test-01' }), /2000/);
  assert.throws(() => validateWebPrompt({ text: '\ud800', requestId: 'web-test-01' }), /文字/);
  assert.throws(() => validateWebPrompt({ text: 'hello', requestId: '../bad' }), /ID/);
});
test('send then poll, deduplicate, and do not re-run model/tools', async () => {
  let calls = 0, finish;
  const { api, stats } = fixture({ ask: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const args = { text: '天気は？', requestId: 'web-test-02' };
  assert.equal(api.send(args).status, 'pending');
  assert.equal(api.send(args).status, 'pending');
  assert.throws(() => api.send({ text: '別件', requestId: 'web-test-03' }), /別の文章/);
  await tick();
  assert.equal(calls, 1);
  assert.equal(api.result(args).status, 'pending');
  finish('晴れです');
  await tick();
  const response = api.result(args);
  assert.equal(response.status, 'complete');
  assert.equal(response.answer, '晴れです');
  assert.equal(response.historySaved, true);
  assert.equal(response.displayed, true);
  assert.equal(response.spoken, false);
  assert.equal(api.send(args).status, 'complete');
  assert.equal(calls, 1);
  assert.deepEqual(stats(), { released: 1, stored: 1, shown: 1 });
});
test('reject unsupported provider, offline, key missing, and busy before network', () => {
  for (const override of [{provider:()=> 'xiaozhi'}, {online:()=> false}, {configured:()=> false}, {reserve:()=>{throw Error('音声会話中')}}]) {
    let called=0;
    const { api }=fixture({...override, ask:async()=>{called++;return 'ok'}});
    assert.throws(()=>api.send({text:'質問',requestId:'web-test-04'}));
    assert.equal(called,0);
  }
});
test('stale reply never saves or displays; errors do not echo secrets', async () => {
  let resolve, active = true;
  const { api, stats } = fixture({ current:()=> active, ask:()=>new Promise(r=>{resolve=r}) });
  api.send({text:'質問',requestId:'web-test-05'});
  await tick();
  active=false;resolve('古い応答');await tick();
  assert.equal(api.result({requestId:'web-test-05'}).status,'failed');
  assert.deepEqual(stats(),{released:1,stored:0,shown:0});
  const second=fixture({ask:async()=>{throw Error('DUMMY_SECRET_ABC')}});
  second.api.send({text:'質問',requestId:'web-test-06'});
  await tick();
  const response=second.api.result({requestId:'web-test-06'});
  assert.equal(response.status,'failed');
  assert.doesNotMatch(response.error,/DUMMY_SECRET_ABC/);
});

test('timeout is reported while holding reservation; late answers cannot write history',async()=>{
  let at=1000,finish,release=0,save=0;
  const actions={provider:()=> 'ollama',online:()=>true,configured:()=>true,reserve(){},current:()=>true,
    ask:()=>new Promise(resolve=>{finish=resolve}),save(){save++;return true},show:()=>true,release(){release++}};
  const api=createWebPromptController(actions,{now:()=>at,timeoutMs:100});
  api.send({text:'test',requestId:'timeout-01'});await tick();
  at+=101;
  assert.equal(api.result({requestId:'timeout-01'}).stillRunning,true);
  assert.equal(api.active(),true);
  assert.throws(()=>api.send({text:'next',requestId:'timeout-02'}));
  finish('late reply');await tick();
  assert.equal(save,0);assert.equal(release,1);assert.equal(api.active(),false);
  assert.equal(api.result({requestId:'timeout-01'}).stillRunning,undefined);
});
test('same requestId cannot change text or repeat after another completed turn',async()=>{
  let calls=0;
  const {api}=fixture({ask:async()=>{calls++;return 'answer'}});
  api.send({text:'first',requestId:'repeat-01'});
  assert.throws(()=>api.send({text:'changed',requestId:'repeat-01'}));await tick();
  assert.throws(()=>api.send({text:'changed',requestId:'repeat-01'}));
  api.send({text:'second',requestId:'repeat-02'});await tick();
  assert.throws(()=>api.send({text:'first',requestId:'repeat-01'}));
  assert.equal(calls,2);
});
test('Ollama errors, display failure and history failure always release reservation',async()=>{
  const {api,stats}=fixture({provider:()=> 'ollama',save(){throw Error('SD blocked')},show(){throw Error('UI closed')}});
  api.send({text:'test',requestId:'failure-01'});await tick();
  const response=api.result({requestId:'failure-01'});
  assert.equal(response.provider,'ollama');assert.equal(response.status,'complete');
  assert.equal(response.historySaved,false);assert.equal(response.displayed,false);
  assert.equal(stats().released,1);
});
