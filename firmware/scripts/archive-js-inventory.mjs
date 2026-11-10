// Read-only source inventory. No firmware, SD, Git, or manifest mutations.
import {readdirSync, readFileSync} from 'node:fs'
import {dirname, resolve, join} from 'node:path'
import {fileURLToPath} from 'node:url'

export function inventoryArchive(appDir) {
 const names=readdirSync(appDir).filter(name=>/^archive-[\w-]+\.js$/.test(name)).sort()
 const modules=names.map(name=>{
  const source=readFileSync(join(appDir,name),'utf8')
  const imports=[...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)]
   .map(match=>match[1]||match[2])
  return {
   file:name,
   lines:source.split(/\r?\n/).length,
   imports:[...new Set(imports)].sort(),
   archiveDependencies:[...new Set(imports.filter(value=>value.startsWith('archive-')))].sort(),
   flags:{
    nativeBinding:/\bnative\s*\(/.test(source),
    nativeSource:/\.c['"]|\.h['"]/.test(source),
    worker:/\bWorker\b|worker\./.test(source),
    piu:/['"]piu\/MC['"]/.test(source),
    device:/\bdevice\.|\brobot\.(?:camera|audio|led|setPose|setTorque)/.test(source),
    dynamicImport:/\bimport\s*\(/.test(source)
   }
  }
 })
 const present=new Set(names.map(name=>name.slice(0,-3)))
 const dependencies=modules.map(m=>({file:m.file,unresolvedArchiveImports:m.archiveDependencies.filter(id=>!present.has(id))}))
 return {root:appDir,count:modules.length,modules,dependencies,note:'Regex-based lexical inventory; not a compiler-verified dependency graph. Manifest aliases, dynamic imports and C/XS hooks require manual review.'}
}

const scriptPath=fileURLToPath(import.meta.url)
if(process.argv[1]&&resolve(process.argv[1])===scriptPath){
 const appDir=resolve(process.argv[2]||join(dirname(scriptPath),'../host/app'))
 process.stdout.write(JSON.stringify(inventoryArchive(appDir),null,2)+'\n')
}
