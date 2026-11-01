export const DEFAULT_GEMINI_MODEL='gemini-3.1-flash-live-preview';
export function geminiSetup(model,functions,instructions){
  return {model:'models/'+(model||DEFAULT_GEMINI_MODEL),generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Aoede'}}}},systemInstruction:{parts:[{text:instructions||'あなたはスタックちゃんです。日本語で簡潔に話してください。時刻や予約は道具で確認し、予約作成が成功するまで設定できたと言わないでください。人物の明示されたプロフィールは道具で記録し、必要な会話だけ検索してください。'}]},tools:functions.length?[{functionDeclarations:functions.map(t=>({name:t.name,description:t.description||'',parametersJsonSchema:t.parameters||{type:'object',properties:{}}}))}]:[],realtimeInputConfig:{automaticActivityDetection:{disabled:false,startOfSpeechSensitivity:'START_SENSITIVITY_HIGH',endOfSpeechSensitivity:'END_SENSITIVITY_LOW',prefixPaddingMs:300,silenceDurationMs:700}},inputAudioTranscription:{},outputAudioTranscription:{}};
}
export function monoPCM(buffer,offset,size,channels=2){
  if(channels!==1&&channels!==2||offset%2||size%(channels*2)||offset<0||size<0||offset+size>buffer.byteLength)throw new Error('Invalid microphone PCM');
  const input=new Int16Array(buffer,offset,size/2),output=new Int16Array(input.length/channels);
  for(let i=0;i<output.length;i++)output[i]=channels===2?(input[i*2]+input[i*2+1])/2:input[i];
  return output.buffer;
}
