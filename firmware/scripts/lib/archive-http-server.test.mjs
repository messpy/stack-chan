import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const fixed=new URL('../../host/app/archive-http-server.js',import.meta.url);
async function check(path,headerLength){
  let listener,parsed=false,failed=false;
  const context=vm.createContext({console,TextDecoder,queueMicrotask});
  vm.runInContext('String.fromArrayBuffer=(buffer,offset=0,length=buffer.byteLength-offset)=>new TextDecoder().decode(new Uint8Array(buffer,offset,length));',context);
  class Socket {
    constructor(options){this.input=options.from?.input??options.input;this.offset=0;this.options=options;if(options.from)queueMicrotask(()=>options.onReadable(this.input.length));}
    read(count){if(this.format==='number')return this.input[this.offset++];const out=this.input.slice(this.offset,this.offset+count);this.offset+=count;return out.buffer;}
    write(){return 65536;}
    close(){}
  }
  class Listener {
    constructor(options){this.options=options;listener=this;this.port=80;this.target=options.target;}
    read(){const pending=this.pending;this.pending=null;return pending;}
    close(){}
  }
  const timer=new vm.SyntheticModule(['default'],function(){this.setExport('default',{set(){return 1},schedule(){},clear(){}})},{context});
  const module=new vm.SourceTextModule(fs.readFileSync(path,'utf8'),{context});
  await module.link(()=>timer);await module.evaluate();
  const server=new module.namespace.default({socket:{io:Listener},keepAlive:0,onConnect(connection){connection.accept({onRequest(){parsed=true},onResponse(){},onError(){failed=true}})}});
  listener.pending=new Socket({input:new TextEncoder().encode('GET / HTTP/1.1\r\nHost: 192.168.4.1\r\nUser-Agent: '+('A'.repeat(headerLength))+'\r\n\r\n')});
  listener.options.onReadable.call(listener);
  await new Promise(resolve=>setImmediate(resolve));
  server.close();return {parsed,failed};
}
for(const length of [20,300,1500,7000])assert.deepEqual(await check(fixed,length),{parsed:true,failed:false});
assert.deepEqual(await check(fixed,9000),{parsed:false,failed:true});
console.log('Fixed: short and long browser headers parsed; oversized header rejected cleanly');
