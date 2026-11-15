import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// These includes belong to version-controlled Archive features, not credentials.
// Keep the list explicit: an arbitrary missing private extension must still fail.
const featureIncludes = [{ include: '../../vendor/koeact/manifest.json', modulePrefix: 'archive-koeact' }]

export function prepareArchivePrivateManifest(filename) {
  const source = path.resolve(filename)
  const unchanged = { manifest: source, changed: false, cleanup() {} }
  if (path.basename(source) !== 'manifest_archive_private.json') return unchanged

  let original, privateManifest, publicManifest
  try {
    original = readFileSync(source, 'utf8')
    privateManifest = JSON.parse(original)
    publicManifest = JSON.parse(readFileSync(path.join(path.dirname(source), 'manifest_archive.example.json'), 'utf8'))
  } catch {
    // JSON parse errors can contain excerpts of credentials. Never forward them.
    throw new Error('Cannot read private/public Archive manifest JSON; original files preserved')
  }
  const includes = privateManifest.include
  if (!Array.isArray(includes)) return unchanged
  const publicIncludes = publicManifest.include ?? []
  const publicModules = Object.keys(publicManifest.modules ?? {})
  const retired = featureIncludes.filter(
    (feature) =>
      includes.includes(feature.include) &&
      !publicIncludes.includes(feature.include) &&
      !publicModules.some((name) => name.startsWith(feature.modulePrefix)),
  )
  if (!retired.length) return unchanged
  if (
    retired.some((feature) =>
      Object.keys(privateManifest.modules ?? {}).some((name) => name.startsWith(feature.modulePrefix)),
    )
  ) {
    throw new Error('Private Archive feature modules conflict with this checkout; originals preserved')
  }
  const staleIncludes = new Set(retired.map((feature) => feature.include))
  const prepared = { ...privateManifest, include: includes.filter((include) => !staleIncludes.has(include)) }
  // Same directory preserves the meaning of every relative module/include path.
  // The caller removes this ignored, mode-0600 copy even when mcconfig fails.
  const manifest = path.join(path.dirname(source), `manifest_archive_private.${randomUUID()}.json`)
  writeFileSync(manifest, `${JSON.stringify(prepared, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return {
    manifest,
    changed: true,
    cleanup() {
      rmSync(manifest, { force: true })
    },
  }
}
