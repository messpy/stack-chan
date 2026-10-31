/** Bounded visible text window, so even long messages stay within Piu's 16-bit coordinates. */
export class MarqueeTextModel {
  text = ''
  width = 1
  contentWidth = 0
  maxAdvance = 1
  scrolling = false
  windowText = ''
  offset = 0
  #characters: string[] = []
  #advances: number[] = []
  #index = 0
  #travel = 0
  finished = false
  constructor(private measure: (character: string) => number) {}
  setText(value: string, width: number): boolean {
    const text = String(value || '').replace(/[\r\n]+/g, ' ')
    width = Math.max(1, width)
    if (text === this.text && width === this.width) return false
    this.text = text
    this.width = width
    this.#characters = Array.from(text)
    this.#advances = this.#characters.map((c) => Math.max(1, this.measure(c)))
    this.contentWidth = this.#advances.reduce((sum, value) => sum + value, 0)
    this.maxAdvance = this.#advances.reduce((max, value) => Math.max(max, value), 1)
    this.scrolling = this.contentWidth > width
    this.#index = 0
    this.offset = 0
    this.#travel = 0
    this.finished = false
    this.#refreshWindow()
    return true
  }
  advance(pixels: number): boolean {
    if (!this.scrolling || this.finished || !Number.isFinite(pixels) || pixels <= 0) return false
    const remaining = Math.max(0, this.contentWidth - this.width - this.#travel)
    const distance = Math.min(pixels, remaining)
    this.#travel += distance
    this.offset += distance
    if (distance >= remaining) this.finished = true
    const oldIndex = this.#index
    while (this.offset >= this.#advances[this.#index]) {
      this.offset -= this.#advances[this.#index]
      this.#index++
    }
    if (this.#index === oldIndex) return false
    this.#refreshWindow()
    return true
  }
  #refreshWindow(): void {
    if (!this.scrolling) {
      this.windowText = this.text
      return
    }
    let width = 0,
      index = this.#index,
      text = ''
    while (width < this.width + this.maxAdvance && index < this.#characters.length) {
      text += this.#characters[index]
      width += this.#advances[index]
      index++
    }
    this.windowText = text
  }
}
