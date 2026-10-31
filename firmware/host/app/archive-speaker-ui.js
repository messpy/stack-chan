import { Container, Label, Text, Skin, Style } from 'piu/MC'
import { createUIButton } from 'archive-ui-button'
import { uiFont } from 'ui-theme'
let robot, actions
export function openSpeakerChooser() {
  robot.ui.application.behavior.closeDrawer?.()
  robot.ui.application.behavior.launchMiniApp('archive-speaker')
}
export function startSpeakerChooser(context, callbacks) {
  robot = context
  actions = callbacks
  robot.ui.miniApps.register({
    id: 'archive-speaker',
    title: '話す人を選択',
    create() {
      const style = new Style({ font: uiFont(), color: 'black', horizontal: 'left', vertical: 'middle' }),
        root = new Container(null, { left: 0, right: 0, top: 0, bottom: 0, skin: new Skin({ fill: 'white' }) })
      let page = 0
      function renderRegistration(e) {
        root.add(
          new Text(null, {
            left: 12,
            right: 12,
            top: 8,
            height: 90,
            style,
            string:
              e.phase === 'listening'
                ? '新規登録：お名前を声で教えてください。\n接続後にマイクで聞き取ります。'
                : e.name
                  ? '「' + e.name + '」さんで登録しますか？'
                  : '名前を聞き取れませんでした。聞き直してください。',
          }),
        )
        const button = (text, method, top, bg) =>
          createUIButton(
            { text, method, background: bg, textColor: '#ffffff' },
            methods,
            { left: 12, right: 12, top, height: 32 },
            onError,
          )
        if (e.phase === 'confirming') {
          if (e.name) root.add(button('この名前で登録', 'confirm', 94, '#167647'))
          root.add(button('声で聞き直す', 'retry', 128, '#2563eb'))
        }
        root.add(button('キャンセル', 'cancel', 162, '#596375'))
      }
      function renderPeople(people, buttons) {
        const total = Math.max(1, Math.ceil(people.length / 2))
        page = Math.max(0, Math.min(page, total - 1))
        root.add(
          new Label(null, {
            left: 8,
            right: 8,
            top: 0,
            height: 22,
            style,
            string: 'あなたは誰？ 話す人を選んでください',
          }),
        )
        for (let i = 0; i < 2; i++) {
          const person = people[page * 2 + i]
          if (person)
            root.add(
              createUIButton(
                buttons.people[page * 2 + i],
                methods,
                { left: 8, right: 8, top: 26 + i * 38, height: 34 },
                onError,
              ),
            )
        }
        if (!people.length)
          root.add(
            new Text(null, {
              left: 12,
              right: 12,
              top: 28,
              height: 64,
              style,
              string: 'まだ登録されていません。\n「新規登録」を押して声で名前を登録できます。',
            }),
          )
        root.add(createUIButton(buttons.previous, methods, { left: 8, top: 104, width: 80, height: 30 }, onError))
        root.add(
          new Label(null, { left: 96, top: 104, width: 128, height: 30, style, string: page + 1 + ' / ' + total }),
        )
        root.add(createUIButton(buttons.next, methods, { right: 8, top: 104, width: 80, height: 30 }, onError))
        root.add(
          createUIButton(
            { ...buttons.register, text: '新規登録（声）' },
            methods,
            { left: 8, top: 140, width: 148, height: 40 },
            onError,
          ),
        )
        root.add(createUIButton(buttons.guest, methods, { right: 8, top: 140, width: 148, height: 40 }, onError))
      }
      function render() {
        root.empty()
        const definitions = actions.list()
        if (definitions.enrollment) renderRegistration(definitions.enrollment)
        else renderPeople(definitions.people, definitions.buttons)
      }
      const onError = (e) => robot.showBalloon(String(e.message || '選択できませんでした'))
      const methods = {
        selectPerson: (args) => actions.select(args),
        register: () => actions.registration?.(),
        confirm: () => actions.confirm(),
        retry: () => actions.retry(),
        cancel: () => actions.cancel(),
        guest: () => actions.select({ guest: true }),
        previous: () => {
          page--
          render()
        },
        next: () => {
          page++
          render()
        },
      }
      render()
      return { content: root }
    },
  })
}
