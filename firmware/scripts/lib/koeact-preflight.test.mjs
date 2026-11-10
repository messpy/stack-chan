import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'
import {inspectKoeAct,parsePartitionCSV,parseSha256Sums,parseArgs} from '../../scripts/koeact-preflight.mjs'

const LAYOUT=[
  '# partition table with explicit offsets',
  'nvs,data,nvs,0x9000,0x6000',
  'factory,app,factory,0x10000,0x700000',
  'model,data,0x40,0x800000,0x500000',
  'a2,data,0x41,0xD00000,0x200000',
].join('\n')+'\n'

async function fixture(){
  const dir=await mkdtemp(path.join(os.tmpdir(),'koeact-preflight-'))
  await mkdir(path.join(dir,'cores3'))
  const names=['cores3/ralomi_e13_stream40.espdl','cores3/a2_weights.bin']
  const lengths=[4_810_000,1_130_000],sums=[]
  for(let i=0;i<names.length;i++){
    const data=Buffer.alloc(lengths[i],i+11)
    await writeFile(path.join(dir,names[i]),data)
    sums.push(createHash('sha256').update(data).digest('hex')+'  '+names[i])
  }
  await writeFile(path.join(dir,'SHA256SUMS'),sums.join('\n')+'\n')
  const csv=path.join(dir,'partitions.csv')
  await writeFile(csv,LAYOUT)
  return {dir,csv}
}
test('SHA256 manifest rejects path traversal and duplicate entries',()=>{
  assert.throws(()=>parseSha256Sums('a'.repeat(64)+'  ../bad.bin\n'),/Unsafe/)
  assert.throws(()=>parseSha256Sums('a'.repeat(64)+'  a\n'+'a'.repeat(64)+'  a'),/Unsafe/)
})
test('CSV rejects absent offsets, 16MB overflow, and partition overlaps',()=>{
  assert.equal(parsePartitionCSV(LAYOUT).find(p=>p.name==='model').size,0x500000)
  assert.throws(()=>parsePartitionCSV('model,data,0x40,,0x500000\n'),/Unresolved/)
  assert.throws(()=>parsePartitionCSV(LAYOUT+'other,data,0x41,0x1000000,1M\n'),/exceeds/)
  assert.throws(()=>parsePartitionCSV(LAYOUT+'other,data,0x41,0x900000,1M\n'),/overlap/)
})
test('Read-only preflight verifies both assets and matching model/a2 flash slots',async()=>{
  const f=await fixture()
  try{
    const result=await inspectKoeAct({modelDir:f.dir,partitionsFile:f.csv,strict:true})
    assert.equal(result.ok,true)
    assert.equal(result.artifacts.length,2)
    assert.equal(result.partition.checked,true)
    assert.equal(result.runtimeLinked,false)
    const noLayout=await inspectKoeAct({modelDir:f.dir})
    assert.equal(noLayout.partition.checked,false)
    await assert.rejects(inspectKoeAct({modelDir:f.dir,strict:true}),/requires/)
  }finally{await rm(f.dir,{recursive:true,force:true})}
})
test('Read-only preflight rejects corrupt weights and undersized partitions',async()=>{
  const f=await fixture()
  try{
    await writeFile(path.join(f.dir,'cores3/a2_weights.bin'),Buffer.alloc(1_130_000,13))
    await assert.rejects(inspectKoeAct({modelDir:f.dir}),/SHA256 mismatch/)
    const data=Buffer.alloc(1_130_000,11)
    await writeFile(path.join(f.dir,'cores3/a2_weights.bin'),data)
    const filename=path.join(f.dir,'SHA256SUMS')
    const original=(await import('node:fs/promises')).readFile
    const sums=(await original(filename,'utf8')).split('\n')
    sums[1]=createHash('sha256').update(data).digest('hex')+'  cores3/a2_weights.bin'
    await writeFile(filename,sums.join('\n'))
    await writeFile(f.csv,LAYOUT.replace('0x500000','0x100000'))
    await assert.rejects(inspectKoeAct({modelDir:f.dir,partitionsFile:f.csv}),/Insufficient partition/)
  }finally{await rm(f.dir,{recursive:true,force:true})}
})
test('CLI parser keeps strict and paths explicit',()=>{
  assert.deepEqual(parseArgs(['--strict','--model-dir','/tmp/model','--partitions','/tmp/layout']),{strict:true,modelDir:'/tmp/model',partitionsFile:'/tmp/layout'})
  assert.throws(()=>parseArgs(['--model-dir']),/Missing/)
})
