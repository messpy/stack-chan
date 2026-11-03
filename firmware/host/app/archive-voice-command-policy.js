// Local voice control policy. Keep this module independent of Moddable hardware.
// KoeAct-JP v1 produces at most two actions; the runtime is NOT included here.
export const KOEACT_THRESHOLD = 0.97

const AMOUNTS = Object.freeze({ slight: 5, normal: 10, large: 20 })
const DIRECTIONS = Object.freeze({ left: 'left', right: 'right', up: 'up', down: 'down', center: 'center' })
const EXPRESSIONS = Object.freeze({ happy: 'happy', sad: 'sad', neutral: 'neutral', angry: 'angry', sleepy: 'sleepy' })
const COLORS = Object.freeze({ red: [96, 0, 0], orange: [96, 40, 0], yellow: [96, 80, 0], green: [0, 96, 0], light_blue: [0, 64, 96], blue: [0, 0, 96], purple: [55, 0, 96], pink: [96, 20, 50], white: [96, 96, 96], off: null })

function isInteger(value, min, max) { return Number.isInteger(value) && value >= min && value <= max }
function keysMatch(value, expected) { return Object.keys(value).sort().join(',') === expected.slice().sort().join(',') }

export function decodeKoeActActions(result) {
  if (!result || !Number.isFinite(result.pAct) || result.pAct < KOEACT_THRESHOLD) return null
  const actions = result.actions
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > 2) return null
  const validated = []
  for (const action of actions) {
    if (!action || typeof action !== 'object' || Array.isArray(action) || !keysMatch(action, ['name', 'arguments'])) return null
    const name = action.name, args = action.arguments
    if (!args || typeof args !== 'object' || Array.isArray(args)) return null
    if (name === 'set_volume' && keysMatch(args, ['level']) && isInteger(args.level, 0, 100)) validated.push({type:'volume', value:args.level})
    else if (name === 'adjust_volume' && keysMatch(args, ['direction','amount']) && (args.direction === 'up' || args.direction === 'down') && Object.hasOwn(AMOUNTS, args.amount)) validated.push({type:'volume_delta', value:(args.direction === 'up' ? 1 : -1) * AMOUNTS[args.amount]})
    else if (name === 'adjust_volume' && keysMatch(args, ['direction','by']) && (args.direction === 'up' || args.direction === 'down') && isInteger(args.by, 1, 100)) validated.push({type:'volume_delta', value:(args.direction === 'up' ? 1 : -1) * args.by})
    else if (name === 'look' && Object.hasOwn(DIRECTIONS,args.direction) && ((keysMatch(args,['direction','amount']) && Object.hasOwn(AMOUNTS,args.amount)) || (keysMatch(args,['direction','degrees']) && isInteger(args.degrees,1,180)))) validated.push({type:'look', value:DIRECTIONS[args.direction]})
    else if (name === 'set_expression' && keysMatch(args,['expression']) && Object.hasOwn(EXPRESSIONS,args.expression)) validated.push({type:'expression', value:EXPRESSIONS[args.expression]})
    else if (name === 'set_led' && keysMatch(args,['color']) && Object.hasOwn(COLORS,args.color)) validated.push({type:'led', value:args.color})
    else return null // Unsupported schema variants fail closed; never partially execute.
  }
  return validated
}

function cleanText(value) {
  if (typeof value !== 'string' || value.length > 160) return ''
  const noWidth = value.replace(/[０-９]/g, char => String(char.charCodeAt(0) - 0xff10))
  return noWidth.trim().replace(/\s+/g, '').replace(/^(?:ねえ)?(?:スタックちゃん|すたっくちゃん|スタックチャン)[、,]?/, '').replace(/[。！!？?、,]+$/, '')
}

export function parseVoiceText(value) {
  const text = cleanText(value)
  if (!text) return null
  if (/^(?:キャンセル|やめて|中止|シャットダウン中止|電源オフ中止)$/.test(text)) return {type:'cancel'}
  if (/^(?:シャットダウン実行|電源オフ実行)$/.test(text)) return {type:'shutdown_confirm'}
  // Reject negated or speculative utterances rather than interpreting their keywords.
  if (/(?:ないで|ません|しない|やめ|なくて|どうすれば|できる|かな|たら|もし)/.test(text)) return null
  if (/^(?:シャットダウン|電源を?切って|電源オフ)(?:して|してください)?$/.test(text)) return {type:'shutdown_request'}
  if (/^(?:AI|ＡＩ|エーアイ)(?:モード)?を?(?:オフ|OFF|切って|停止)(?:にして|して|してください)?$/i.test(text)) return {type:'ai_off'}
  if (/^(?:(?:サイト|スマホ操作|操作画面|ウェブ|Web)(?:の)?)?(?:QRコード|QR|キューアール)(?:を)?(?:出して|表示して|見せて|開いて)(?:ください)?$/i.test(text)) return {type:'qr'}
  const fixed = /^音量(?:を)?(\d{1,3})(?:(?:%|％|パーセント)(?:に|にして|に設定して|に変更して|にしてください)?|(?:に|にして|に設定して|に変更して|にしてください))$/.exec(text)
  if (fixed) return isInteger(Number(fixed[1]),0,100) ? {type:'volume',value:Number(fixed[1])} : {type:'invalid_volume'}
  if (/^音量(?:を)?(?:上げて|あげて|大きくして|アップして|上げてください|あげてください|大きくしてください|アップしてください)$/.test(text)) return {type:'volume_delta',value:10}
  if (/^音量(?:を)?(?:下げて|さげて|小さくして|ダウンして|下げてください|さげてください|小さくしてください|ダウンしてください)$/.test(text)) return {type:'volume_delta',value:-10}
  if (/^(?:ミュートして|消音して|音量を?ゼロにして)$/.test(text)) return {type:'volume',value:0}
  return null
}

export function createVoiceCommandController(actions) {
  let pendingUntil = 0
  const now = actions.now || (() => Date.now())
  const execute = command => {
    if (!command) return {handled:false}
    if (pendingUntil && now() > pendingUntil) pendingUntil = 0
    const type = command.type
    if (type === 'cancel') { const had = pendingUntil > 0; pendingUntil = 0; return {handled:had, message:had ? 'シャットダウンを取り消しました' : ''} }
    if (type === 'shutdown_request') { pendingUntil = now() + 10000; return {handled:true, message:'電源を切りますか？10秒以内に「シャットダウン実行」と言ってください'} }
    if (type === 'shutdown_confirm') {
      if (!pendingUntil) return {handled:false}
      pendingUntil = 0
      if (typeof actions.powerOff !== 'function') return {handled:true, message:'電源OFFはまだ実装されていません。実行しません'}
      actions.powerOff(); return {handled:true, message:'電源を切ります'}
    }
    if (type === 'invalid_volume') return {handled:true,message:'音量は0から100%で指定してください'}
    if (type === 'volume' || type === 'volume_delta') {
      const current = actions.getVolume().percent
      const target = Math.max(0,Math.min(100,type === 'volume' ? command.value : current + command.value))
      actions.setVolume(target)
      return {handled:true,message:'音量 '+target+'%'}
    }
    if (type === 'ai_off') { actions.stopAI(); return {handled:true,message:'AI会話を停止します'} }
    if (type === 'qr') { actions.openQR(); return {handled:true,message:'スマホ操作のQRを表示します'} }
    if (type === 'look') { actions.moveHead(command.value); return {handled:true,message:''} }
    if (type === 'expression') { actions.setExpression(command.value); return {handled:true,message:''} }
    if (type === 'led') { actions.setLED(command.value === 'off' ? null : COLORS[command.value]); return {handled:true,message:''} }
    return {handled:false}
  }
  return {
    handleText(text) { return execute(parseVoiceText(text)) },
    handleKoeAct(result) {
      const parsed = decodeKoeActActions(result)
      if (!parsed) return {handled:false} // STT fallback, if available.
      // Reject a future destructive extension or unknown action before any execution.
      for (const command of parsed) if (!['volume','volume_delta','look','expression','led'].includes(command.type)) return {handled:false}
      const results = parsed.map(execute)
      return {handled:true,results}
    },
    pendingShutdown() { return pendingUntil > now() },
  }
}
