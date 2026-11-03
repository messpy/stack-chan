import {createVoiceCommandController,parseVoiceText} from 'archive-voice-command-policy';
import Timer from 'timer';

let controller;
let feedback;
let transcriptCount=0, matchedCount=0, lastCommandType='';

function later(label, action){
  Timer.set(()=>{
    try{
      const result=action();
      if(result && typeof result.catch==='function')
        result.catch(()=>{trace('[voice-command] '+label+' failed\n');feedback?.('操作に失敗しました');});
    }catch(_){trace('[voice-command] '+label+' failed\n');feedback?.('操作に失敗しました');}
  },0);
}

export function startVoiceControl(actions){
  feedback=actions.feedback;
  transcriptCount=0; matchedCount=0; lastCommandType='';
  controller=createVoiceCommandController({
    getVolume:actions.getVolume,
    setVolume:actions.setVolume,
    openQR:()=>later('qr',actions.openQR),
    stopAI:()=>later('ai-off',actions.stopAI),
    moveHead:direction=>later('head',()=>actions.moveHead(direction)),
    setExpression:actions.setExpression,
    setLED:actions.setLED,
    // No powerOff callback until the CoreS3 PMIC interface is verified.
  });
}

// No native ESP-DL runner or model weights are linked in this firmware yet.
export function voiceControlStatus(){
  return {routerReady:!!controller,sttTextCommands:!!controller,koeactOfflineReady:false,
    stage:'adapter-only',reason:'native KoeAct-JP CoreS3 runner not linked',
    transcriptCount,matchedCount,lastCommandType};
}

export function handleVoiceTranscript(text){
  transcriptCount++;
  if(!controller)return false;
  const command=parseVoiceText(text);
  if(!command)return false;
  try{
    const result=controller.handleText(text);
    if(!result.handled)return false;
    matchedCount++; lastCommandType=command.type;
    if(result.message)feedback?.(result.message);
    return true;
  }catch(_){trace('[voice-command] transcript execution failed\n');feedback?.('音声操作に失敗しました');return true;}
}

// Called only after a future KoeAct-JP runner has validated its audio source.
// The pre-trained model/decoder are NOT yet linked to the archive firmware.
export function handleKoeActResult(result){
  if(!controller)return false;
  try{
    const outcome=controller.handleKoeAct(result);
    if(!outcome.handled)return false;
    for(const item of outcome.results||[])if(item.message)feedback?.(item.message);
    return true;
  }catch(_){trace('[voice-command] KoeAct action execution failed\n');feedback?.('音声操作に失敗しました');return true;}
}
