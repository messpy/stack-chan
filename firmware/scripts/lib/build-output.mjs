import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const libraryDirectory = dirname(fileURLToPath(import.meta.url))

export const hostApplicationName = 'stack-chan-host'
export const firmwareDirectory = resolve(libraryDirectory, '../..')
export const buildOutputDirectory = join(firmwareDirectory, 'dist')

/**
 * Creates the repository-local Moddable output root if it does not exist.
 * mcconfig requires the directory passed to -o to exist before it starts.
 * @returns {string} Absolute output directory path.
 */
export function ensureBuildOutputDirectory() {
  mkdirSync(buildOutputDirectory, { recursive: true })
  return buildOutputDirectory
}

/**
 * Removes all generated Stack-chan build artifacts and leaves an empty output
 * root ready for mcconfig.
 * @returns {string} Absolute output directory path.
 */
export function cleanBuildOutputDirectory() {
  rmSync(buildOutputDirectory, { recursive: true, force: true })
  return ensureBuildOutputDirectory()
}

/**
 * Rejects a caller-supplied output directory so repository commands cannot
 * silently write outside firmware/dist.
 * @param {string[]} args - Arguments forwarded to a Moddable build tool.
 */
export function assertNoCustomBuildOutput(args) {
  if (args.some((arg) => arg === '-o' || arg.startsWith('-o='))) {
    throw new Error(`-o is managed by Stack-chan build commands and fixed to ${buildOutputDirectory}`)
  }
}

/**
 * Returns the output selector shared by mcconfig, mcrun, and mcpack.
 * @returns {string[]}
 */
export function moddableOutputArguments() {
  // Keep artifacts in firmware/dist, but shorten the output path passed to
  // Moddable: generated Makefile recipes repeat the path for every module.
  if (process.platform !== 'linux' || buildOutputDirectory.length < 80) {
    return ['-o', buildOutputDirectory]
  }

  ensureBuildOutputDirectory()
  const id = createHash('sha256').update(buildOutputDirectory).digest('hex').slice(0, 12)
  const alias = join(tmpdir(), `sc-build-${id}`)
  if (existsSync(alias) || isExistingSymlink(alias)) {
    if (!lstatSync(alias).isSymbolicLink() || readlinkSync(alias) !== buildOutputDirectory) {
      throw new Error(`short build output alias already exists and points elsewhere: ${alias}`)
    }
  } else {
    symlinkSync(buildOutputDirectory, alias, 'dir')
  }
  return ['-o', alias]
}

function isExistingSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
