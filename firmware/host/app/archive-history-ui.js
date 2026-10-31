import { Container, Label, Skin, Style, Text } from 'piu/MC'
import { ActionButton } from 'ui-controls'
import { uiFont } from 'ui-theme'
export function historyPages(text) {
  const pages = []
  let lines = [],
    line = '',
    width = 0
  const endLine = () => {
    lines.push(line)
    line = ''
    width = 0
    if (lines.length === 7) {
      pages.push(lines.join('\n'))
      lines = []
    }
  }
  for (const char of String(text || '').replace(/\r/g, '')) {
    if (char === '\n') {
      endLine()
      continue
    }
    const size = char.charCodeAt(0) < 128 ? 1 : 2
    if (width + size > 48) endLine()
    line += char
    width += size
  }
  if (line || (!lines.length && !pages.length)) endLine()
  if (lines.length) pages.push(lines.join('\n'))
  return pages
}
function stamp(value) {
  const d = new Date(value + 9 * 3600000),
    pad = (n) => String(n).padStart(2, '0')
  return (
    d.getUTCFullYear() +
    '/' +
    pad(d.getUTCMonth() + 1) +
    '/' +
    pad(d.getUTCDate()) +
    ' ' +
    pad(d.getUTCHours()) +
    ':' +
    pad(d.getUTCMinutes())
  )
}
// Keep history navigation independent of Piu widgets and cache wrapping per message.
export class HistoryState {
  constructor(read) {
    this.read = read
    this.items = []
    this.row = 0
    this.part = 0
    this.pages = ['']
    this.failed = false
  }

  load(userId) {
    try {
      this.items = this.read({ user_id: userId, limit: 10 }).items.slice(0, 10)
      this.failed = false
    } catch (_) {
      this.items = []
      this.failed = true
    }
    this.select(0)
  }

  get current() {
    return this.items[this.row]
  }

  select(row) {
    this.row = row
    this.part = 0
    this.pages = historyPages(this.current?.text)
  }

  moveMessage(direction) {
    const row = this.row + direction
    if (row >= 0 && row < this.items.length) this.select(row)
  }

  moveText(direction) {
    const part = this.part + direction
    if (part >= 0 && part < this.pages.length) this.part = part
  }
}

function messageHeading(item) {
  if (!item) return ''
  const speaker = item.role === 'assistant' ? 'StackChan' : item.name || 'ゲスト'
  const partner = item.role === 'assistant' && item.partner ? ' / ' + item.partner : ''
  return stamp(item.created) + ' ' + speaker + partner
}

export function startHistoryUI(robot, actions) {
  robot.ui.miniApps.register({
    id: 'archive-history',
    title: '会話履歴',
    create() {
      let known = [],
        current
      try {
        known = actions.people()
        current = actions.current()
      } catch (_) {}
      const people = [{ id: null, name: '全員' }, ...known]
      let filter = Math.max(
        0,
        people.findIndex((person) => person.id === current?.id),
      )
      const state = new HistoryState((args) => actions.read(args))
      const style = new Style({ font: uiFont(), color: 'black', horizontal: 'left', vertical: 'top' })
      const meta = new Label(null, { left: 8, right: 8, top: 30, height: 18, style, string: '' })
      const body = new Text(null, { left: 8, right: 8, top: 50, height: 94, style, string: '' })
      const position = new Label(null, { left: 8, right: 8, top: 144, height: 14, style, string: '' })
      const button = (label, onTap, layout) => new ActionButton({ label, onTap }, layout)
      const navigate = (method, direction) => () => {
        state[method](direction)
        render()
      }
      const toggle = button(
        '',
        () => {
          filter = (filter + 1) % people.length
          load()
        },
        { left: 8, top: 0, width: 218, height: 26 },
      )
      const refresh = button('更新', load, { right: 8, top: 0, width: 78, height: 26 })
      const previousText = button('前の文', navigate('moveText', -1), { left: 8, top: 162, width: 70, height: 30 })
      const nextText = button('次の文', navigate('moveText', 1), { left: 86, top: 162, width: 70, height: 30 })
      const newer = button('新しい', navigate('moveMessage', -1), { left: 164, top: 162, width: 70, height: 30 })
      const older = button('古い', navigate('moveMessage', 1), { left: 242, top: 162, width: 70, height: 30 })

      function render() {
        const item = state.current
        toggle.content('label').string = '話す人: ' + people[filter].name.slice(0, 16)
        meta.string = messageHeading(item)
        body.string = state.failed
          ? 'SDの会話履歴を読めませんでした。'
          : item
            ? state.pages[state.part]
            : '会話履歴はありません'
        position.string = item
          ? '履歴 ' +
            (state.row + 1) +
            ' / ' +
            state.items.length +
            '　文章 ' +
            (state.part + 1) +
            ' / ' +
            state.pages.length
          : ''
        previousText.active = state.part > 0
        nextText.active = state.part + 1 < state.pages.length
        newer.active = state.row > 0
        older.active = state.row + 1 < state.items.length
      }

      function load() {
        state.load(people[filter].id)
        render()
      }
      load()
      return {
        content: new Container(null, {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          skin: new Skin({ fill: 'white' }),
          contents: [toggle, refresh, meta, body, position, previousText, nextText, newer, older],
        }),
      }
    },
  })
}
