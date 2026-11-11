import { delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'

const wrapperDirectory = fileURLToPath(new URL('../moddable-make', import.meta.url))

export function moddableMakeEnvironment(env) {
  if (process.platform !== 'linux') return env
  return { ...env, PATH: [wrapperDirectory, env.PATH].join(delimiter) }
}
