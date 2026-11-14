import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const templateRelativePath = 'tools/mcconfig/make.esp32.mk'
const xslRelativePath = 'xs/tools/xsl.c'
const originalRecipe = '\txsl -b $(MODULES_DIR) -o $(TMP_DIR) $(PRELOADS) $(STRIPS) $(CREATION) $(MODULES)'
const argFileRecipe = [
  '\t$(file >$(TMP_DIR)/args.txt,-b $(MODULES_DIR) -o $(TMP_DIR) $(PRELOADS) $(STRIPS) $(CREATION) $(MODULES))',
  '\tcd "$(TMP_DIR)" && xsl args.txt',
].join('\n')

/**
 * Avoid Linux execve(2) argument-length errors in large ESP32 Archive builds.
 * GNU Make writes the full module list itself; xsl reads literal args.txt.
 * This is a persistent, reversible local Moddable SDK template patch.
 */
export function prepareModdableXslArgsFile({ moddableDirectory = process.env.MODDABLE } = {}) {
  const { templatePath, current } = inspectTemplate(moddableDirectory)
  if (current.includes(argFileRecipe)) {
    if (current.includes(originalRecipe)) throw new Error('Conflicting xsl recipes in ' + templatePath)
    return { status: 'already-patched', templatePath }
  }
  if (current.split(originalRecipe).length !== 2) {
    throw new Error('Unsupported Moddable xsl recipe in ' + templatePath + '; refusing to modify SDK')
  }
  const xslSource = path.join(moddableDirectory, xslRelativePath)
  if (!existsSync(xslSource) || !readFileSync(xslSource, 'utf8').includes('c_strcmp(argv[1], "args.txt")')) {
    throw new Error('Moddable xsl does not advertise args.txt support: ' + xslSource)
  }
  replaceTemplate(templatePath, current, current.replace(originalRecipe, argFileRecipe))
  return { status: 'patched', templatePath }
}

/** Restore only this specific recipe; retain every other SDK modification. */
export function restoreModdableXslArgsFile({ moddableDirectory = process.env.MODDABLE } = {}) {
  const { templatePath, current } = inspectTemplate(moddableDirectory)
  if (!current.includes(argFileRecipe)) {
    if (current.includes(originalRecipe)) return { status: 'already-original', templatePath }
    throw new Error('Unrecognized Moddable xsl recipe in ' + templatePath + '; refusing to modify SDK')
  }
  if (current.split(argFileRecipe).length !== 2 || current.includes(originalRecipe)) {
    throw new Error('Conflicting xsl recipes in ' + templatePath)
  }
  replaceTemplate(templatePath, current, current.replace(argFileRecipe, originalRecipe))
  return { status: 'restored', templatePath }
}

function inspectTemplate(moddableDirectory) {
  if (!moddableDirectory) throw new Error('MODDABLE environment variable is required')
  const templatePath = path.join(moddableDirectory, templateRelativePath)
  return { templatePath, current: readFileSync(templatePath, 'utf8') }
}

function replaceTemplate(templatePath, before, after) {
  if (readFileSync(templatePath, 'utf8') !== before) {
    throw new Error('Moddable template changed during patch: ' + templatePath)
  }
  const temporary = templatePath + '.stackchan-' + process.pid + '.tmp'
  try {
    writeFileSync(temporary, after, { mode: statSync(templatePath).mode })
    renameSync(temporary, templatePath)
  } finally {
    rmSync(temporary, { force: true })
  }
}
