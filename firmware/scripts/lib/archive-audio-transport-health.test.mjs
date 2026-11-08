import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import test from 'node:test'

test('upload health records socket acceptance, not locally queued PCM',async()=>{
 let now=1000,socket
 class Socket{constructor(options){this.options=options;socket=this}write(data,options){this.writes??=[];this.writes.push({data,options});return 0}close(){}}
 class Base{connect(){}postMessage(){}}
 const context=vm.createContext({Date:{now:()=>now},Uint8Array,ArrayBuffer,device:{network:{wss:{io:Socket},ws:{io:Socket}}}})
 const deps={ChatWorker:{default:Base},JSONBase64Parser:{default:class{}},'text/encoder':{default:TextEncoder}}
 const module=new vm.SourceTextModule(fs.readFileSync(new URL('../../host/modules/conversation/chat-audioio/server-chat-websocket-worker.js',import.meta.url),'utf8'),{context})
 await module.link(name=>new vm.SyntheticModule(Object.keys(deps[name]),function(){for(const[k,v]of Object.entries(deps[name]))this.setExport(k,v)},{context}));await module.evaluate()
 const worker=new module.namespace.default({});worker.connect({})
 worker.write(new Uint8Array(100),{binary:true});assert.equal(worker.lastBinaryWriteAt,undefined,'network has no writable credit yet')
 now=2000;socket.options.onWritable(50);assert.equal(worker.lastBinaryWriteAt,2000,'partial actual socket write is progress')
 now=3000;socket.options.onWritable(100);assert.equal(worker.lastBinaryWriteAt,3000)
 now=4000;worker.write(new Uint8Array(20),{binary:false});socket.options.onWritable(50);assert.equal(worker.lastBinaryWriteAt,3000,'protocol events do not count as audio')
 worker.close();assert.equal(worker.lastBinaryWriteAt,0)
 worker.write(new Uint8Array(20),{binary:true});assert.equal(worker.lastBinaryWriteAt,0,'closed socket cannot report progress')
})
