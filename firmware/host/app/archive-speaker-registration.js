export const enrollmentInstructions =
  'あなたはスタックちゃんです。これは新規ユーザーの名前登録だけを行うセッションです。日本語で「お名前を教えてください」と短く聞いてください。聞いた名前の登録は本体の確認ボタンで行います。登録完了と言わず、通常の会話や道具の実行はしないでください。'

export function registrationName(text) {
  const name = String(text || '')
    .trim()
    .replace(/[。！!？?]+$/g, '')
    .replace(/^(?:私の名前は|僕の名前は|名前は|私は|僕は)/, '')
    .replace(/(?:と呼んでください|と呼んで|といいます|と言います|です)$/, '')
    .trim()
  if (
    !name ||
    name.length > 24 ||
    /[\r\n。、！？!?：:]/.test(name) ||
    /こんにちは|ありがとう|わからない|分からない|キャンセル|登録|タイマー|アラーム|教えて|誰/.test(name)
  )
    return ''
  return name
}

// Name recognition is provisional. Only the controller's confirm action saves a profile.
export class VoiceRegistration {
  #state = null
  get active() {
    return this.#state !== null
  }
  get phase() {
    return this.#state?.phase
  }
  snapshot() {
    return this.#state ? { ...this.#state } : null
  }
  start() {
    this.#state = { phase: 'listening', name: '' }
  }
  reset() {
    this.#state = null
  }
  receive(text) {
    if (this.phase !== 'listening') return false
    this.#state = { phase: 'confirming', name: registrationName(text) }
    return true
  }
  confirmedName() {
    if (this.phase !== 'confirming' || !this.#state.name) throw new Error('名前を聞き直してください')
    return this.#state.name
  }
}

// Only a clear self-introduction is handled locally; ambiguous speech stays with AI.
export function explicitSpeakerName(text){
  const value=String(text||'').trim();
  if(!/^(?:私の名前は|僕の名前は|名前は|私は|僕は)|(?:です|といいます|と言います)[。！!]*$/.test(value))return '';
  const name=registrationName(value);
  if(/^(?:はい|いいえ|そう|元気|大丈夫|よろしく|聞こえ|テスト)/.test(name))return '';
  return name;
}
