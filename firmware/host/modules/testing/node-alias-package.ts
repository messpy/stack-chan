import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

let atomicWriteCounter = 0

// node --test runs each test file in its own process, and several files write the
// same shared node_modules/<alias> packages concurrently. A plain writeFileSync lets
// one process read a half-written package.json ("Invalid package config"), so publish
// each file atomically via a per-process temp file + rename.
function atomicWriteFileSync(path: string, content: string): void {
  const tempPath = `${path}.${process.pid}.${atomicWriteCounter++}.tmp`
  writeFileSync(tempPath, content)
  renameSync(tempPath, path)
}

export function writeAliasPackage(
  modulesRoot: string,
  name: string,
  target: string,
  options: {
    hasDefaultExport?: boolean
  } = {},
): void {
  const packageRoot = resolve(modulesRoot, 'node_modules', name)
  const targetSpecifier = relative(packageRoot, target).replaceAll('\\', '/')
  const importSpecifier = targetSpecifier.startsWith('.') ? targetSpecifier : `./${targetSpecifier}`
  mkdirSync(packageRoot, { recursive: true })
  // Another test worker may import this alias as soon as package.json exists.
  // Publish its entry point first so resolution never observes a package with
  // a missing index.js. Each file is itself published with an atomic rename.
  atomicWriteFileSync(
    `${packageRoot}/index.js`,
    [
      `export * from ${JSON.stringify(importSpecifier)};`,
      options.hasDefaultExport ? `export { default } from ${JSON.stringify(importSpecifier)};` : '',
      '',
    ].join('\n'),
  )
  atomicWriteFileSync(`${packageRoot}/package.json`, JSON.stringify({ type: 'module', exports: './index.js' }))
}

export function writeAliasPackageSubpath(
  modulesRoot: string,
  packageName: string,
  subpath: string,
  target: string,
  options: {
    hasDefaultExport?: boolean
  } = {},
): void {
  const packageRoot = resolve(modulesRoot, 'node_modules', packageName)
  const entryPath = resolve(packageRoot, `${subpath}.js`)
  const targetSpecifier = relative(dirname(entryPath), target).replaceAll('\\', '/')
  const importSpecifier = targetSpecifier.startsWith('.') ? targetSpecifier : `./${targetSpecifier}`
  const packagePath = `${packageRoot}/package.json`
  const packageConfig = existsSync(packagePath)
    ? JSON.parse(readFileSync(packagePath, 'utf8'))
    : { type: 'module', exports: {} }
  const exports =
    typeof packageConfig.exports === 'object' && packageConfig.exports != null ? packageConfig.exports : {}

  mkdirSync(dirname(entryPath), { recursive: true })
  exports[`./${subpath}`] = `./${subpath}.js`
  // Publish the new subpath target before exposing its export in package.json.
  atomicWriteFileSync(
    entryPath,
    [
      `export * from ${JSON.stringify(importSpecifier)};`,
      options.hasDefaultExport ? `export { default } from ${JSON.stringify(importSpecifier)};` : '',
      '',
    ].join('\n'),
  )
  atomicWriteFileSync(
    packagePath,
    JSON.stringify({
      ...packageConfig,
      type: 'module',
      exports,
    }),
  )
}
