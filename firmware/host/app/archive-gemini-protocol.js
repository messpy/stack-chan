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

// Keep a real microphone channel rather than averaging opposite-phase inputs.
// Gain is bounded and saturating; it does not change the PCM sample rate.
export function recognitionPCM(buffer,offset,size,channels=1,gain=4){
  if(channels!==1&&channels!==2||offset%2||size%(channels*2)||offset<0||size<0||offset+size>buffer.byteLength)throw new Error('Invalid microphone PCM');
  const input=new Int16Array(buffer,offset,size/2),frames=input.length/channels;
  let left=0,right=0;
  for(let i=0;i<frames;i++){const a=input[i*channels];left+=a*a;if(channels===2){const b=input[i*2+1];right+=b*b;}}
  const channel=channels===2&&right>left?1:0,output=new Int16Array(frames);
  gain=Math.max(1,Math.min(8,Number(gain)||1));
  let peak=0;
  for(let i=0;i<frames;i++){const sample=Math.max(-32768,Math.min(32767,Math.round(input[i*channels+channel]*gain)));output[i]=sample;peak=Math.max(peak,Math.abs(sample));}
  return {buffer:output.buffer,channel,leftRms:Math.round(Math.sqrt(left/Math.max(1,frames))),rightRms:channels===2?Math.round(Math.sqrt(right/Math.max(1,frames))):0,peak};
}
