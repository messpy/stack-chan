import Timer from 'timer'
import { Container, Text, Skin, Style } from 'piu/MC'
import { uiFont } from 'ui-theme'
import { createUIButton } from 'archive-ui-button'
export function startAISettings(robot, actions) {
  robot.ui.miniApps.register({
    id: 'archive-ai-settings',
    title: 'AIを選ぶ',
    hidden: true,
    create() {
      const root = new Container(null, { left: 0, right: 0, top: 0, bottom: 0, skin: new Skin({ fill: 'white' }) }),
        style = new Style({ font: uiFont(), color: 'black', horizontal: 'left', vertical: 'middle' })
      let signature = ''
      const fail = (e) => robot.showBalloon(String(e.message || 'AI設定を確認してください'))
      const methods = {
        selectAI: (args) => {
          actions.select(args)
          render()
        },
        toggle: () => {
          robot.ui.application.behavior.onMiniAppBack()
        },
      }
      function render() {
        const s = actions.status(),
          next = s.provider + ':' + s.recognition + ':' + s.geminiConfigured + ':' + s.ollamaConfigured + ':' + s.enabled + ':' + s.configured
        if (next === signature) return
        signature = next
        root.empty()
        root.add(
          new Text(null, {
            left: 10,
            right: 10,
            top: 2,
            height: 40,
            style,
            string:
              '選択中: ' +
              (s.provider === 'ollama' ? 'Ollama Cloud' : s.provider === 'gemini' ? 'Gemini' : 'XiaoZhi') +
              ' / 会話 ' +
              (s.enabled ? 'ON' : 'OFF') +
              '\n接続設定: ' +
              (s.configured ? '保存済み' : '未設定'),
          }),
        )
        for (const [index, provider] of ['xiaozhi', 'gemini', 'ollama'].entries())
          root.add(
            createUIButton(
              {
                text:
                  (provider === 'ollama' ? 'Ollama Cloud' : provider === 'gemini' ? 'Gemini' : 'XiaoZhi') +
                  (s.provider === provider ? ' [選択中]' : ''),
                background: s.provider === provider ? '#167647' : '#596375',
                textColor: '#ffffff',
                method: 'selectAI',
                args: { provider },
              },
              methods,
              { left: 10, right: 10, top: 48 + index * 30, height: 28 },
              fail,
            ),
          )
        root.add(createUIButton({text:'認識: '+(s.recognition==='xiaozhi'?'XiaoZhi':'自動'),background:'#596375',textColor:'#ffffff',method:'selectAI',args:{provider:s.provider,recognition:s.recognition==='xiaozhi'?'auto':'xiaozhi'}},methods,{left:10,right:10,top:140,height:28},fail))
        root.add(
          createUIButton(
            {
              text: '戻る',
              background: '#2563eb',
              textColor: '#ffffff',
              method: 'toggle',
            },
            methods,
            { left: 10, right: 10, top: 172, height: 28 },
            fail,
          ),
        )
      }
      render()
      const timer = Timer.repeat(render, 2000)
      return {
        content: root,
        dispose() {
          Timer.clear(timer)
        },
      }
    },
  })
}
