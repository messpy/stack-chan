import { Port, Texture, type Port as PiuPort } from 'piu/MC'
let heart: Texture | undefined
let shy: Texture | undefined
class M5PetEffectBehavior extends Behavior {
  onCreate(port: PiuPort) { port.interval = 500 }
  onDisplaying(port: PiuPort) { port.start(); port.invalidate() }
  onUndisplaying(port: PiuPort) { port.stop() }
  onTimeChanged(port: PiuPort) { port.invalidate() }
  onDraw(port: PiuPort) {
    heart ??= new Texture('m5-pet-heart.png')
    shy ??= new Texture('m5-pet-shy.png')
    const cx = port.width / 2
    const cy = port.height / 2
    const frame = Math.floor(port.time / 500) % 2
    port.drawTexture(heart, '#e13232', cx + 108 - 28, cy - 70 - 28, frame * 56, 0, 56, 56)
    port.drawTexture(shy, '#f7a59e', cx - 108 - 19, cy + 28 - 9, 0, 0, 39, 18)
    port.drawTexture(shy, '#f7a59e', cx + 108 - 19, cy + 28 - 9, 0, 0, 39, 18)
  }
}
export const M5PetEffect = Port.template(() => ({ left: 0, right: 0, top: 0, bottom: 0, Behavior: M5PetEffectBehavior }))
