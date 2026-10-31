import { Container, Label, Text, Skin, Style } from 'piu/MC'
import { uiFont } from 'ui-theme'
import { createUIButton } from 'archive-ui-button'
import { TTS } from 'archive-offline-tts'
import { localClockStatus, clockParts, japaneseEpoch, setLocalTime } from 'archive-local-clock'
let robot,
  actions,
  voice,
  playing = false,
  lastText = '',
  error = '',
  minutes = 3
export function offlineStatus() {
  return {
    available: true,
    speech: 'local-japanese-tts',
    recognition: false,
    playing,
    lastText,
    error,
    clock: localClockStatus(),
  }
}
export async function offlineAction(action) {
  if (!['hello', 'time', 'status', 'timer', 'stop'].includes(action)) throw new Error('操作を選んでください')
  if (playing) throw new Error('お話し中です')
  await actions.stopCloud()
  if (!actions.claim()) throw new Error('本体で別の処理をしています')
  playing = true
  let unlock
  try {
    let text
    if (action === 'hello') text = 'こんにちは。スタックちゃんです。ネットがなくても、ここにいるよ。'
    else if (action === 'time') {
      const s = localClockStatus()
      text = s.ready
        ? '今は、' + s.parts.hour + '時' + s.parts.minute + '分です。'
        : '時計がまだ設定されていません。時計設定で合わせてね。'
    } else if (action === 'timer') {
      actions.tool('timer_create', { seconds: minutes * 60, title: 'オフラインタイマー' })
      text = minutes + '分のタイマーを設定しました。'
    } else if (action === 'stop') {
      actions.tool('alarm_stop', {})
      text = 'アラームを停止します。'
    } else text = '本体だけで動いています。アラームとタイマー、声のお返事ができます。画面のボタンを押してね。'
    lastText = text
    error = ''
    robot.showBalloon(text)
    unlock = robot.audio.acquireExclusive()
    if (globalThis.amp) globalThis.amp.sampleRate = 24000
    voice ??= new TTS({ volume: robot.audio.volume })
    await new Promise((resolve, reject) => voice.stream(text, robot.audio.volume, (e) => (e ? reject(e) : resolve())))
    return { spoken: true, text }
  } catch (e) {
    error = String(e.message || '音声を再生できませんでした').slice(0, 160)
    throw e
  } finally {
    unlock?.()
    playing = false
    actions.release()
  }
}
export function openOffline() {
  actions.stopCloud()
  robot.ui.application.behavior.closeDrawer?.()
  robot.ui.application.behavior.launchMiniApp('archive-offline')
  return offlineStatus()
}
export function startOffline(context, callbacks) {
  robot = context
  actions = callbacks
  const style = new Style({ font: uiFont(), color: 'black', horizontal: 'center', vertical: 'middle' })
  const fail = (e) => robot.showBalloon(String(e.message || '操作できませんでした'))
  const button = (text, method, methods, layout) =>
    createUIButton({ text, method, background: '#236a5a', textColor: '#ffffff' }, methods, layout, fail)
  robot.ui.miniApps.register({
    id: 'archive-offline',
    title: 'オフライン',
    create() {
      const methods = {
        hello: () => offlineAction('hello'),
        time: () => offlineAction('time'),
        status: () => offlineAction('status'),
        timer: () => robot.ui.application.behavior.launchMiniApp('archive-offline-timer'),
        alarm: () => actions.openAlarms(),
        clock: () => robot.ui.application.behavior.launchMiniApp('archive-local-clock'),
      }
      const root = new Container(null, { left: 0, right: 0, top: 0, bottom: 0, skin: new Skin({ fill: 'white' }) })
      root.add(
        new Text(null, {
          left: 8,
          right: 8,
          top: 2,
          height: 35,
          style,
          string: 'ネット不要・ボタンでおしゃべり\n音声の聞き取りには未対応です',
        }),
      )
      for (const [i, [text, method]] of [
        ['こんにちは', 'hello'],
        ['今何時？', 'time'],
        ['タイマー', 'timer'],
        ['アラーム', 'alarm'],
        ['時計設定', 'clock'],
        ['できること', 'status'],
      ].entries())
        root.add(
          button(text, method, methods, {
            left: i % 2 ? 164 : 8,
            top: 42 + Math.floor(i / 2) * 46,
            width: 148,
            height: 40,
          }),
        )
      return { content: root }
    },
  })
  robot.ui.miniApps.register({
    id: 'archive-offline-timer',
    title: 'オフラインタイマー',
    hidden: true,
    create() {
      const value = new Label(null, { left: 8, right: 8, top: 4, height: 36, style, string: minutes + ' 分' })
      const methods = {
        less: () => {
          minutes = Math.max(1, minutes - 1)
          value.string = minutes + ' 分'
        },
        more: () => {
          minutes = Math.min(120, minutes + 1)
          value.string = minutes + ' 分'
        },
        start: () => offlineAction('timer'),
        stop: () => {
          actions.tool('alarm_stop')
        },
      }
      return {
        content: new Container(null, {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          skin: new Skin({ fill: 'white' }),
          contents: [
            value,
            button('−1分', 'less', methods, { left: 8, top: 44, width: 148, height: 36 }),
            button('＋1分', 'more', methods, { right: 8, top: 44, width: 148, height: 36 }),
            button('開始して声で確認', 'start', methods, { left: 8, right: 8, top: 88, height: 42 }),
            button('鳴っている音を停止', 'stop', methods, { left: 8, right: 8, top: 138, height: 42 }),
          ],
        }),
      }
    },
  })
  robot.ui.miniApps.register({
    id: 'archive-local-clock',
    title: '本体の時計（日本時間）',
    hidden: true,
    create() {
      const parts = clockParts(),
        keys = ['year', 'month', 'day', 'hour', 'minute'],
        labels = ['年', '月', '日', '時', '分']
      let selected = 0
      const value = new Text(null, { left: 8, right: 8, top: 0, height: 65, style, string: '' })
      const render = () => {
        value.string =
          parts.year +
          '/' +
          parts.month +
          '/' +
          parts.day +
          ' ' +
          parts.hour +
          ':' +
          ('0' + parts.minute).slice(-2) +
          '\n変更する項目: ' +
          labels[selected]
      }
      const change = (delta) => {
        const key = keys[selected],
          range =
            key === 'year'
              ? [2024, 2099]
              : key === 'month'
                ? [1, 12]
                : key === 'day'
                  ? [1, 31]
                  : key === 'hour'
                    ? [0, 23]
                    : [0, 59]
        parts[key] = parts[key] + delta
        if (parts[key] < range[0]) parts[key] = range[1]
        if (parts[key] > range[1]) parts[key] = range[0]
        render()
      }
      const methods = {
        less: () => change(-1),
        more: () => change(1),
        next: () => {
          selected = (selected + 1) % keys.length
          render()
        },
        save: () => {
          setLocalTime(japaneseEpoch(parts))
          value.string =
            '時計を設定しました。\n' +
            (localClockStatus().error
              ? localClockStatus().error
              : localClockStatus().rtc
                ? 'RTCにも保存しました'
                : '電源を切ると再設定が必要です')
        },
      }
      render()
      return {
        content: new Container(null, {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          skin: new Skin({ fill: 'white' }),
          contents: [
            value,
            button('−', 'less', methods, { left: 8, top: 70, width: 92, height: 38 }),
            button('項目を切替', 'next', methods, { left: 114, top: 70, width: 92, height: 38 }),
            button('＋', 'more', methods, { right: 8, top: 70, width: 92, height: 38 }),
            button('この日時を保存', 'save', methods, { left: 8, right: 8, top: 120, height: 42 }),
          ],
        }),
      }
    },
  })
  robot.drawer.addDrawerButton({ key: 'offlineMode', label: 'オフライン（本体だけ）', callback: openOffline })
}
