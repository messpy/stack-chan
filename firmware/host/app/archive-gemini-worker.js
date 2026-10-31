import {installDebugLog} from 'archive-debug';
// Uses the Moddable SDK Gemini Live transport (LGPL-3.0-or-later).
import GoogleGeminiLiveModel from 'googleGeminiLiveModel';
import {geminiSetup,monoPCM} from 'archive-gemini-protocol';
class ArchiveGeminiLiveModel extends GoogleGeminiLiveModel {
  configure(message){super.configure(message);this.path='/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key='+encodeURIComponent(message.apiKey||'');this.setup=geminiSetup(message.modelID,message.functions||[],message.instructions);}
  sendAudio(message){if(!this.speaking)return;const pcm=monoPCM(this.inputBuffer,message.offset,message.size,message.channels||2);this.sendJSON({realtimeInput:{audio:{mimeType:'audio/pcm;rate=16000',data:new Uint8Array(pcm).toBase64()}}});}
  sendFunctionResult(message){this.sendJSON({toolResponse:{functionResponses:[{id:message.call,name:message.name,response:{output:message.result}}]}});}
  onJSON(json){if(json.error){this.postMessage({id:'failed',string:'Gemini API '+String(json.error.code||'')+': '+(json.error.code===429?'利用上限です':json.error.code===401||json.error.code===403?'APIキー・利用権限を確認してください':json.error.code===404?'指定した会話モデルを利用できません':'接続設定を確認してください')});return;}if(json.goAway){this.postMessage({id:'failed',string:'Gemini session renewal'});return;}super.onJSON(json);}
}
installDebugLog();
new ArchiveGeminiLiveModel({inputSampleRate:16000,outputSampleRate:24000});
