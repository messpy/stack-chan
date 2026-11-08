// Text-only web AI turns. No microphone or device tools are exposed.
export function validateWebPrompt(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('入力形式が正しくありません');
  const { text, requestId } = args;
  if (typeof text !== 'string' || text.length > 2000) throw new Error('文章は2000文字以内で入力してください');
  const prompt = text.trim();
  if (!prompt) throw new Error('送信する文章を入力してください');
  let bytes;
  try { bytes = encodeURIComponent(prompt).replace(/%[0-9a-f]{2}/gi, '_').length; }
  catch (_) { throw new Error('使用できない文字が含まれています'); }
  if (bytes > 8192) throw new Error('文章はUTF-8で8KiB以内にしてください');
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,72}$/.test(requestId))
    throw new Error('送信IDが正しくありません');
  return { text: prompt, requestId };
}

export function createWebPromptController(actions, {now=Date.now,timeoutMs=65000}={}) {
  let pending = null;
  let last = null, lastRequestText;
  const recent=[];
  const retentionMs=180000;
  const expired = turn => now()-turn.startedAt>=timeoutMs;
  const summary = turn => expired(turn)&&turn.status==='pending'
    ? {requestId:turn.requestId,status:'failed',provider:turn.provider,stillRunning:true,error:'応答がタイムアウトしました。処理終了まで新しい送信をお待ちください'}
    : { requestId: turn.requestId, status: turn.status, provider: turn.provider };
  function result(args) {
    const { requestId } = validateRequestId(args);
    if (pending?.requestId === requestId) return summary(pending);
    if (last?.requestId === requestId && now() - last.finishedAt < retentionMs) {
      const { finishedAt, ...response } = last;
      return response;
    }
    throw new Error('送信結果がありません。もう一度入力してください');
  }
  function validateRequestId(args) {
    if (!args || typeof args !== 'object' || typeof args.requestId !== 'string'
      || !/^[a-zA-Z0-9_-]{8,72}$/.test(args.requestId))
      throw new Error('送信IDが正しくありません');
    return { requestId: args.requestId };
  }
  function send(args) {
    const request = validateWebPrompt(args);
    if (pending?.requestId === request.requestId) {
      if(pending.text!==request.text)throw new Error('同じ送信IDで文章を変更できません');
      return summary(pending);
    }
    if (last?.requestId === request.requestId && now() - last.finishedAt < retentionMs) {
      if(lastRequestText!==request.text)throw new Error('同じ送信IDで文章を変更できません');
      return result(request);
    }
    while(recent.length&&now()-recent[0].at>=retentionMs)recent.shift();
    if(recent.some(entry=>entry.id===request.requestId))
      throw new Error('この送信IDは処理済みです。自動再送は行いません');
    if (pending) throw new Error('別の文章の応答を待っています');
    const provider = actions.provider();
    if (provider !== 'gemini' && provider !== 'ollama')
      throw new Error('XiaoZhiの文字送信は未対応です。GeminiまたはOllama Cloudを選択してください');
    if (!actions.online()) throw new Error('Wi-Fiが未接続です。ネットワークを確認してください');
    if (!actions.configured(provider)) throw new Error('選択したAIのAPIキーを設定してください');
    actions.reserve(provider);
    const turn = { ...request, provider, status: 'pending',startedAt:now() };
    recent.push({id:request.requestId,at:now()});if(recent.length>16)recent.shift();
    pending = turn;
    Promise.resolve().then(async () => {
      try {
        const current = () => pending === turn && !expired(turn) && actions.current(provider);
        const answer = await actions.ask(turn.text, provider, current);
        if (!current()) throw new Error('会話が切り替わりました');
        if (typeof answer !== 'string' || !answer.trim()) throw new Error('回答が空でした');
        let historySaved = false, displayed = false;
        try { historySaved = actions.save(turn.text, answer, turn.requestId) === true; } catch (_) {}
        try { displayed = actions.show(answer) === true; } catch (_) {}
        last = { ...summary(turn), status: 'complete', answer, historySaved, displayed, spoken: false, finishedAt: now() };
      } catch (_) {
        // Provider errors can echo credentials, user text, or upstream response bodies.
        last = { ...summary(turn), status: 'failed', error: '回答を取得できませんでした。通信状態・APIキー・モデル設定を確認してください', finishedAt: now() };
      } finally {
        if(last?.requestId===turn.requestId)delete last.stillRunning;
        lastRequestText=turn.text;
        if (pending === turn) pending = null;
        actions.release();
      }
    });
    return summary(turn);
  }
  return { send, result, active: () => pending !== null };
}
