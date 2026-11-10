import assert from 'node:assert/strict'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {test} from 'node:test'
import {inventoryArchive} from '../archive-js-inventory.mjs'

const appDir=resolve(dirname(fileURLToPath(import.meta.url)),'../../host/app')

test('read-only inventory includes archive source files and their dependencies',()=>{
 const report=inventoryArchive(appDir)
 assert.ok(report.count>=40)
 assert.equal(report.modules.length,report.count)
 assert.ok(report.modules.every(row=>row.file.startsWith('archive-')&&row.file.endsWith('.js')))
 assert.ok(report.modules.some(row=>row.file==='archive-memory.js'&&row.flags.nativeBinding))
 assert.ok(report.modules.some(row=>row.file==='archive-direct-chat.js'&&row.archiveDependencies.includes('archive-memory')))
 assert.equal(new Set(report.modules.map(row=>row.file)).size,report.count)
})

test('inventory JSON contains no source bodies or credential values',()=>{
 const report=inventoryArchive(appDir)
 assert.equal(JSON.stringify(report).includes('accessToken:'),false)
 assert.ok(report.modules.every(row=>!('content' in row)))
})
