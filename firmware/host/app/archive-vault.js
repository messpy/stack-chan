import {sealVault,openVault,randomBytes} from 'archive-usb';
import {withSDCard} from 'stackchan-sdcard';
let data={generation:0,wifi:null,api:{},reminders:[]};
let loaded=false;
let loadError=false;
const path=index=>`stackchan/settings-${index}.bin`;
export function randomHex(){return Array.from(new Uint8Array(randomBytes()),b=>b.toString(16).padStart(2,'0')).join('');}
export function loadSettings(){
  if(loaded)return data;
  let found=false;
  withSDCard(root=>{
    try{root.createDirectory('stackchan');}catch(_){}
    for(let index=0;index<2;index++){
      let file;
      try{
        file=root.openFile({path:path(index),mode:'r'});found=true;
        const size=file.status().size;
        if(size<36||size>65572)throw new Error('size');
        const candidate=JSON.parse(String.fromArrayBuffer(openVault(file.read(size,0))));
        if(!Number.isSafeInteger(candidate.generation)||candidate.generation<1||!Array.isArray(candidate.reminders)||typeof candidate.api!=='object')throw new Error('schema');
        if(candidate.generation>data.generation)data=candidate;
      }catch(_){}finally{file?.close();}
    }
  });
  loadError=found&&data.generation===0;loaded=true;
  if(loadError)trace('[settings] encrypted settings could not be authenticated; originals preserved\n');
  return data;
}
export function getSettings(){return loadSettings();}
export function changeSettings(change){
  loadSettings();
  // Never overwrite the last two encrypted snapshots with empty defaults when
  // both exist but neither could be authenticated on this boot.
  if(loadError)throw new Error('保存済み設定を読み取れません。元のSD設定は保持しています');
  const next=JSON.parse(JSON.stringify(data));change(next);next.generation=data.generation+1;
  const encrypted=sealVault(ArrayBuffer.fromString(JSON.stringify(next)));
  let persisted=false;
  withSDCard(root=>{
    const file=root.openFile({path:path(next.generation%2),mode:'w'});
    try{file.write(encrypted,0);file.flush();persisted=true;}finally{file.close();}
  });
  if(!persisted)throw new Error('SDカードに設定を保存できませんでした');
  data=next;loadError=false;
  return data;
}
export function vaultStatus(){return {encrypted:true,generation:data.generation,loadError,chatMode:data.chatMode===true,transcriptionMode:data.transcriptionMode===true,apiNames:Object.keys(data.api),ssid:data.wifi?.ssid??''};}
export function vaultSelfTest(){
  const plain=ArrayBuffer.fromString('configuration-encryption-self-test');
  const sealed=sealVault(plain);
  const name=`stackchan/vault-check-${randomHex()}.bin`;
  let restored;
  withSDCard(root=>{
    let file=root.openFile({path:name,mode:'w'});
    try{file.write(sealed,0);file.flush();}finally{file.close();}
    try{file=root.openFile({path:name,mode:'r'});restored=openVault(file.read(file.status().size,0));}
    finally{file?.close();root.delete(name);}
  });
  new Uint8Array(sealed)[sealed.byteLength-1]^=1;
  let tamperRejected=false;try{openVault(sealed);}catch(_){tamperRejected=true;}
  return {sdRoundtrip:String.fromArrayBuffer(restored)===String.fromArrayBuffer(plain),tamperRejected};
}
