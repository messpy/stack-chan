import type { Container as PiuContainer } from 'piu/MC'

export const MINI_APP_BAR_HEIGHT = 44

export type MiniAppContext = Readonly<{
  width: number
  height: number
  close(): void
}>

export type MiniAppInstance = Readonly<{
  content: PiuContainer
  dispose?(): void
}>

export type MiniAppDefinition = Readonly<{
  id: string
  title: string
  icon?: 'play'
  hidden?: boolean
  availability?: () => string | undefined
  create(context: MiniAppContext): PiuContainer | MiniAppInstance
}>

export type RegisteredMiniApp = Readonly<Pick<MiniAppDefinition, 'id' | 'title' | 'icon'> & { unavailableReason?: string }>

export type MiniAppRegistryCapability = Readonly<{
  register(definition: MiniAppDefinition): () => void
  setAvailability?(id: string, available: boolean, reason?: string): boolean
  refreshAvailability?(): void
}>

type RegistryListener = () => void

const MINI_APP_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const MAX_MINI_APP_ID_LENGTH = 64
const MAX_MINI_APP_TITLE_LENGTH = 32

function validateDefinition(definition: MiniAppDefinition): MiniAppDefinition {
  if (!definition || typeof definition !== 'object') throw new TypeError('mini app definition must be an object')
  if (
    typeof definition.id !== 'string' ||
    definition.id.length === 0 ||
    definition.id.length > MAX_MINI_APP_ID_LENGTH ||
    !MINI_APP_ID_PATTERN.test(definition.id)
  ) {
    throw new TypeError('mini app id must be 1-64 lowercase ASCII characters separated by ., _, or -')
  }
  const title = typeof definition.title === 'string' ? definition.title.trim() : ''
  if (title.length === 0 || title.length > MAX_MINI_APP_TITLE_LENGTH) {
    throw new TypeError('mini app title must be 1-32 characters')
  }
  if (typeof definition.create !== 'function') throw new TypeError('mini app create must be a function')
  return Object.freeze({
    id: definition.id,
    title,
    ...(definition.icon ? { icon: definition.icon } : {}),
    ...(definition.hidden ? { hidden: true } : {}),
    ...(definition.availability ? { availability: definition.availability } : {}),
    create: definition.create,
  })
}

export class MiniAppRegistry implements MiniAppRegistryCapability {
  #definitions = new Map<string, MiniAppDefinition>()
  #listeners = new Set<RegistryListener>()
  #unavailable = new Map<string, string>()

  register(definition: MiniAppDefinition): () => void {
    const validated = validateDefinition(definition)
    if (this.#definitions.has(validated.id)) throw new Error(`mini app id is already registered: ${validated.id}`)
    this.#definitions.set(validated.id, validated)
    this.#notify()
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      if (this.#definitions.get(validated.id) !== validated) return
      this.#definitions.delete(validated.id)
      this.#unavailable.delete(validated.id)
      this.#notify()
    }
  }

  setAvailability(id: string, available: boolean, reason = '現在利用できません'): boolean {
    if (!this.#definitions.has(id)) return false
    const previous = this.#unavailable.get(id)
    if (available) this.#unavailable.delete(id)
    else this.#unavailable.set(id, reason.trim() || '現在利用できません')
    if (previous !== this.#unavailable.get(id)) this.#notify()
    return true
  }

  refreshAvailability(): void {
    for (const definition of this.#definitions.values()) {
      if (!definition.availability) continue
      try {
        const reason = definition.availability()
        this.setAvailability(definition.id, !reason, reason)
      } catch (error) {
        if (typeof trace === 'function') trace(`[MiniApp] availability check failed id=${definition.id}: ${String(error)}\n`)
        this.setAvailability(definition.id, false, '機能の状態を確認できません')
      }
    }
  }

  unavailableReason(id: string): string | undefined {
    return this.#unavailable.get(id)
  }

  get(id: string): MiniAppDefinition | undefined {
    return this.#definitions.get(id)
  }

  list(): RegisteredMiniApp[] {
    return [...this.#definitions.values()]
      .filter((definition) => !definition.hidden)
      .map(({ id, title, icon }) => Object.freeze({ id, title, ...(icon ? { icon } : {}), ...(this.#unavailable.has(id) ? { unavailableReason: this.#unavailable.get(id) } : {}) }))
      .sort((left, right) => left.title.localeCompare(right.title))
  }

  subscribe(listener: RegistryListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}
