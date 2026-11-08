// Execute production diagnostic logic without binding native USB/Timer modules.
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const text=readFileSync(new URL('../../host/app/archive-debug.js',import.meta.url),'utf8')
const code=text.slice(text.indexOf('// Bounded, credential-free diagnostics.'))
const module=new vm.SourceTextModule(code,{context:vm.createContext({Date,Number,String,JSON,RegExp,Error})})
await module.link(()=>{throw new Error('Pure diagnostics unexpectedly imported hardware')})
await module.evaluate()
export const {createVoiceTurnTracker,memoryReasonCode}=module.namespace
