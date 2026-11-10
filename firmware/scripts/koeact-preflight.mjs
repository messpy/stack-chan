// Read-only preflight for official KoeAct-JP CoreS3 assets and optional ESP-IDF partition CSV.
// Never downloads, flashes, or changes device/local files.
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {readFile,stat} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

export const FLASH_BYTES = 16 * 1024 * 1024
export const ASSETS = Object.freeze([
  {name:'cores3/ralomi_e13_stream40.espdl',min:4_000_000,max:6_000_000,partition:'model'},
  {name:'cores3/a2_weights.bin',min:900_000,max:1_600_000,partition:'a2'},
])

export function parseSha256Sums(text) {
  const sums=new Map()
  for(const raw of text.split(/\r?\n/)) {
    const row=raw.trim()
    if(!row || row.startsWith('#'))continue
    const match=/^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(row)
    if(!match)throw Error('Malformed SHA256SUMS line')
    const name=match[2].trim().replace(/^\.\//,'')
    if(!name || name.startsWith('/') || name.includes('\\') ||
       name.split('/').includes('..') || sums.has(name))throw Error('Unsafe or duplicate SHA256SUMS path')
    sums.set(name,match[1].toLowerCase())
  }
  return sums
}

function parseSize(value) {
  const raw=String(value||'').trim()
  if(/^0x[0-9a-f]+$/i.test(raw))return parseInt(raw,16)
  const match=/^(\d+)([KM])?$/i.exec(raw)
  if(!match)throw Error('Unresolved partition size/offset')
  return Number(match[1])*(match[2]?.toUpperCase()==='K'?1024:match[2]?.toUpperCase()==='M'?1024*1024:1)
}

export function parsePartitionCSV(text) {
  const partitions=[],names=new Set()
  for(const raw of text.split(/\r?\n/)) {
    const line=raw.trim()
    if(!line || line.startsWith('#'))continue
    const columns=line.split(',').map(v=>v.trim())
    if(columns.length<5)throw Error('Malformed partition entry')
    const [name,type,subtype,offset,size]=columns
    if(!/^[a-zA-Z_0-9-]{1,16}$/.test(name)||names.has(name))throw Error('Duplicate or invalid partition name')
    const start=parseSize(offset),capacity=parseSize(size)
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(capacity)||start<0||capacity<=0)throw Error('Invalid partition extent')
    if(start%4096!==0)throw Error('Partition offset is not 4KB aligned: '+name)
    if(start+capacity>FLASH_BYTES)throw Error('Partition exceeds 16MB flash: '+name)
    names.add(name)
    partitions.push({name,type,subtype,offset:start,size:capacity})
  }
  const ordered=partitions.slice().sort((a,b)=>a.offset-b.offset)
  for(let i=1;i<ordered.length;i++)if(ordered[i-1].offset+ordered[i-1].size>ordered[i].offset)
    throw Error('Partition overlap: '+ordered[i-1].name+' / '+ordered[i].name)
  return partitions
}

async function sha256File(file) {
  const hash=createHash('sha256')
  for await(const chunk of createReadStream(file))hash.update(chunk)
  return hash.digest('hex')
}

export async function inspectKoeAct({modelDir,partitionsFile,strict=false}={}) {
  if(!modelDir)throw Error('Specify --model-dir PATH')
  if(strict&&!partitionsFile)throw Error('Strict mode requires --partitions PATH')
  const sums=parseSha256Sums(await readFile(path.join(modelDir,'SHA256SUMS'),'utf8'))
  const artifacts=[]
  for(const entry of ASSETS) {
    const expected=sums.get(entry.name)
    if(!expected)throw Error('Missing SHA256SUMS entry for '+entry.name)
    const target=path.join(modelDir,entry.name)
    const info=await stat(target)
    if(!info.isFile()||info.size<entry.min||info.size>entry.max)
      throw Error('Unexpected size for '+entry.name+' (expected official CoreS3 artifact)')
    const actual=await sha256File(target)
    if(actual!==expected)throw Error('SHA256 mismatch: '+entry.name)
    artifacts.push({name:entry.name,bytes:info.size,partition:entry.partition,sha256Valid:true})
  }
  let partitionResult={checked:false,reason:'No built partition CSV supplied'}
  if(partitionsFile) {
    const partitions=parsePartitionCSV(await readFile(partitionsFile,'utf8'))
    const used=new Set()
    for(const entry of artifacts){
      const match=partitions.find(p=>p.name===entry.partition)
      if(!match||match.type!=='data')throw Error('Missing data partition: '+entry.partition)
      if(match.size<entry.bytes)throw Error('Insufficient partition: '+entry.partition)
      if(used.has(match.name))throw Error('Duplicate partition assignment')
      used.add(match.name)
    }
    partitionResult={checked:true,modelBytes:partitions.find(p=>p.name==='model').size,
      decoderBytes:partitions.find(p=>p.name==='a2').size}
  }
  return {ok:true,readOnly:true,modelArtifactsVerified:true,partition:partitionResult,
    runtimeLinked:false,coreS3InferenceVerified:false,artifacts}
}

export function parseArgs(args) {
  const options={}
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--strict'){options.strict=true;continue}
    if(args[i]==='--model-dir'||args[i]==='--partitions') {
      if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing argument for '+args[i])
      options[args[i]==='--model-dir'?'modelDir':'partitionsFile']=args[++i]
      continue
    }
    throw Error('Unknown option: '+args[i])
  }
  return options
}

async function main() {
  try {
    const options=parseArgs(process.argv.slice(2))
    const result=await inspectKoeAct(options)
    console.log('[CHECK] Official CoreS3 artifacts: SHA256 OK')
    if(result.partition.checked)console.log('[CHECK] Flash partition capacity: OK')
    else console.log('[WARN] Flash partition capacity: not verified; do not flash')
    console.log('[WARN] KoeAct-JP native model runtime: not linked; no offline speech inference')
    console.log(JSON.stringify(result))
  }catch(error) {
    console.error('[FATAL] STEP=koeact-preflight '+String(error?.message||error))
    process.exitCode=1
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()
