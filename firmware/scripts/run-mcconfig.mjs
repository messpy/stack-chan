#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { assertNoCustomBuildOutput, buildOutputDirectory, ensureBuildOutputDirectory, hostApplicationName, moddableOutputArguments } from './lib/build-output.mjs'
import { prepareCoreS3IdfDependencies } from './lib/idf-dependencies.mjs'
import { prepareCoreS3VersionSdkconfig } from './lib/moddable-version.mjs'

const args = process.argv.slice(2)

try {
  assertNoCustomBuildOutput(args)
} catch (error) {
  console.error(`[stack-chan] ${error.message}`)
  process.exit(1)
}

ensureBuildOutputDirectory()
// The archive manifest uses esp_jpeg, esp_audio_codec, and esp32-camera.
// Pre-populate the generated IDF YAML before Moddable's parallel make rules
// can run concurrent `idf.py add-dependency` writes to the same file.
if (targetsArchiveCoreS3(args) && args[args.indexOf('-t') + 1] !== 'clean') {
  try {
    const mode = args.some(value => ['-d', '-dn', '-dx', '-dl'].includes(value))
      ? 'debug'
      : args.includes('-i') ? 'instrument' : 'release'
    prepareCoreS3IdfDependencies({
      outputDirectory: buildOutputDirectory,
      platformName: 'm5stack_cores3',
      applicationName: hostApplicationName,
      mode,
      archive: true,
    })
  } catch (error) {
    console.error(`[stack-chan] Archive IDF dependency preparation failed: ${error.message}`)
    process.exit(1)
  }
}
let subprocessEnvironment = process.env
if (targetsM5StackChanCoreS3(args)) {
  try {
    const versionSdkconfig = prepareCoreS3VersionSdkconfig()
    subprocessEnvironment = { ...process.env, SDKCONFIGPATH: versionSdkconfig.directory }
  } catch (error) {
    console.error(`[stack-chan] CoreS3 firmware version could not be prepared: ${error.message}`)
    process.exit(1)
  }
}
const result = spawnSync('mcconfig', [...moddableOutputArguments(), ...args], {
  env: subprocessEnvironment,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`[stack-chan] mcconfigを実行できませんでした: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)

function targetsM5StackChanCoreS3(values) {
  const platformIndex = values.indexOf('-p')
  return platformIndex >= 0 && values[platformIndex + 1]?.toLowerCase().includes('m5stackchan_cores3')
}

function targetsArchiveCoreS3(values) {
  const platformIndex = values.indexOf('-p')
  return platformIndex >= 0 && values[platformIndex + 1] === 'esp32/m5stack_cores3' &&
    values.some(value => value.endsWith('/host/app/manifest_archive_private.json') ||
      value === 'host/app/manifest_archive_private.json')
}
