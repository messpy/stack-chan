import { localSpeech } from 'archive-offline-speech'
import Timer from 'timer'
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
  minutes = 3,
  faceButtons,
  menuPage = 0
export function offlineStatus() {
  return {
    available: true,
    faceButtonsVisible: !!faceButtons,
    speech: 'local-japanese-tts',
    recognition: false,
    playing,
    lastText,
    error,
    clock: localClockStatus(),
  }
}
export async function offlineAction(action, options = {}) {
  if (!['hello', 'time', 'status', 'timer', 'stop'].includes(action)) throw new Error('操作を選んでください')
  if (playing) throw new Error('お話し中です')
  await actions.stopCloud()
  if (!actions.claim()) throw new Error('本体で別の処理をしています')
  playing = true
  let unlock
  try {
    let text
    const clock = localClockStatus()
    if (action === 'hello') text = 'こんにちは。スタックちゃんです。ネットがなくても、ここにいるよ。'
    else if (action === 'time') {
      const s = clock
      text = s.ready
        ? '今は、' + s.parts.hour + '時' + s.parts.minute + '分です。'
        : '時計がまだ設定されていません。時計設定で合わせてね。'
    } else if (action === 'timer') {
      const created=actions.tool('timer_create', { seconds: minutes * 60, title: 'オフラインタイマー' })
      options.onTimerCreated?.(created)
      text = minutes + '分のタイマーを設定しました。'
    } else if (action === 'stop') {
      actions.tool('alarm_stop', {})
      text = 'アラームを停止します。'
    } else text = '本体だけで動いています。アラームとタイマー、声のお返事ができます。画面のボタンを押してね。'
    lastText = text
    error = ''
    robot.showBalloon(text, { bottom: options.bottom ?? (faceButtons ? 50 : 12) })
    unlock = robot.audio.acquireExclusive()
    if (globalThis.amp) globalThis.amp.sampleRate = 24000
    voice ??= new TTS({
      volume: robot.audio.volume,
      speed: 80,
      onPlayed: (power) => robot.face?.setMouthOpen(Math.min(1, power / 2000)),
      onDone: () => robot.face?.setMouthOpen(0),
    })
    for (const part of localSpeech(action, clock, minutes)) {
      await new Promise((resolve, reject) =>
        voice.stream(part.text, robot.audio.volume, (e) => (e ? reject(e) : resolve())),
      )
      if (part.pause) await new Promise((resolve) => Timer.set(resolve, part.pause))
    }
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
export function closeOffline() {
  closeFaceButtons()
  robot.hideBalloon?.()
}
function closeFaceButtons() {
  if (faceButtons) {
    robot.ui.removeEffect(faceButtons)
    faceButtons = undefined
  }
}
function showFaceButtons(mode) {
  closeFaceButtons()
  const strip = new Container(null, { left: 0, right: 0, bottom: 0, height: 44 })
  const fail = (e) => robot.showBalloon(String(e.message || '操作できませんでした'), { bottom: faceButtons ? 50 : 12 })
  const add = (text, method, methods, left, width) =>
    strip.add(
      createUIButton(
        { text, method, background: '#236a5a', textColor: '#ffffff' },
        methods,
        { left, top: 2, width, height: 38 },
        fail,
      ),
    )
  if (mode === 'timer') {
    let started=false
    const methods = {
      less: () => {
        minutes = Math.max(1, minutes - 1)
        showFaceButtons('timer')
      },
      more: () => {
        minutes = Math.min(120, minutes + 1)
        showFaceButtons('timer')
      },
      start: async () => {
        if(started)return
        started=true
        let committed=false
        try{
          return await offlineAction('timer',{onTimerCreated:()=>{committed=true;if(faceButtons===strip)showFaceButtons('home')}})
        }catch(error){
          if(!committed)started=false
          if(committed)throw new Error('タイマーは設定済みです。読み上げだけ失敗しました')
          throw error
        }
      },
      back: () => showFaceButtons('home'),
    }
    add('−', 'less', methods, 4, 60)
    add(minutes + '分 開始', 'start', methods, 68, 120)
    add('＋', 'more', methods, 192, 60)
    add('戻る', 'back', methods, 256, 60)
  } else {
    const choices = [
      ['こんにちは', 'hello'],
      ['今何時？', 'time'],
      ['タイマー', 'timer'],
      ['アラーム', 'alarm'],
      ['時計設定', 'clock'],
      ['できること', 'status'],
      ['AIと会話', 'online'],
      ['AI選択', 'ai'],
    ]
    const methods = {
      hello: () => offlineAction('hello'),
      time: () => offlineAction('time'),
      status: () => offlineAction('status'),
      timer: () => showFaceButtons('timer'),
      alarm: () => actions.openAlarms(),
      clock: () => robot.ui.application.behavior.launchMiniApp('archive-local-clock'),
      online: () => actions.startCloud(),
      ai: () => actions.openAI(),
      next: () => {
        menuPage = (menuPage + 1) % Math.ceil(choices.length / 2)
        showFaceButtons('home')
      },
      close: closeFaceButtons,
    }
    for (let i = 0; i < 2; i++) {
      const [text, method] = choices[menuPage * 2 + i]
      add(text, method, methods, 4 + i * 108, 104)
    }
    add('次へ', 'next', methods, 220, 56)
    add('×', 'close', methods, 280, 36)
  }
  faceButtons = strip
  robot.ui.addEffect(strip, 'archive-offline-choices')
}
export function openOffline() {
  actions.stopCloud()
  robot.ui.application.behavior.closeDrawer?.()
  robot.ui.showFace()
  showFaceButtons('home')
  return offlineStatus()
}
export function startOffline(context, callbacks) {
  robot = context
  actions = callbacks
  const style = new Style({ font: uiFont(), color: 'black', horizontal: 'center', vertical: 'middle' })
  const fail = (e) => robot.showBalloon(String(e.message || '操作できませんでした'), { bottom: faceButtons ? 50 : 12 })
  const button = (text, method, methods, layout) =>
    createUIButton({ text, method, background: '#236a5a', textColor: '#ffffff' }, methods, layout, fail)
  robot.ui.miniApps.register({
    id: 'archive-offline',hidden:true,
    title: 'オフライン',
    create(context) {
      context.close()
      Timer.set(openOffline, 0)
      return { content: new Container(null, { left: 0, right: 0, top: 0, bottom: 0 }) }
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
