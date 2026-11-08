import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../..',import.meta.url))
function manifests(name,seen=new Set()){
 const file=path.resolve(root,name);if(seen.has(file))return {};seen.add(file)
 const data=JSON.parse(fs.readFileSync(file,'utf8'));let result={...data.modules}
 for(const include of data.include||[]){
  if(include.startsWith('.')&&fs.existsSync(path.resolve(path.dirname(file),include)))
   result={...manifests(path.relative(root,path.resolve(path.dirname(file),include)),seen),...result}
 }
 return result
}
test('both feature test suites are registered and resolve to existing files',()=>{
 const data=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'))
 const registered=data.scripts['test:archive-ui'].split(/\s+/)
 for(const name of ['archive-web-prompt','archive-voice-turn','archive-web-prompt-integration']){
  const file='scripts/lib/'+name+'.test.mjs';assert.ok(registered.includes(file));assert.ok(fs.existsSync(path.join(root,file)))
 }
})
test('public Archive manifest supplies new web and inherited idle/audio module definitions',()=>{
 const available=manifests('host/app/manifest_archive.example.json')
 for(const name of ['archive-web-prompt','archive-debug','archive-idle-face','archive-idle-policy'])assert.ok(available[name],name)
 const server=JSON.parse(fs.readFileSync(path.join(root,'host/modules/conversation/chat-audioio/server.manifest.json'),'utf8'))
 assert.ok(server.modules.stackchanAsyncAudioOut)
})
