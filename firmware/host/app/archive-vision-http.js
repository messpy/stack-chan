import Timer from 'timer';
let lastHTTP;
export function visionHTTPStatus(){return lastHTTP?{...lastHTTP}:null;}
export function postVision(host,path,headers,body,method='POST',timeoutMs=20000){return new Promise((resolve,reject)=>{
 lastHTTP={host,method,uploaded:0,size:body.byteLength,received:0,status:0,phase:'connecting',started:Date.now()};
 let client,done=false,status=0,offset=0,total=0;const chunks=[];
 const finish=(error,value)=>{if(done)return;done=true;lastHTTP.phase=error?'error':'complete';lastHTTP.elapsedMs=Date.now()-lastHTTP.started;Timer.clear(timeout);error?reject(error):resolve(value);Timer.set(()=>{try{client?.close();}catch(_){}},0);};
 const timeout=Timer.set(()=>finish(new Error('画像認識がタイムアウトしました。写真はSDに保存済みです。')),timeoutMs);
 try{const options=device.network.https.client;client=new options.io({...options,host,port:443,socket:{...options.socket,tls:{...options.socket.tls,verify:true}}});
  client.request({method,path,headers:new Map([...headers,['content-length',String(body.byteLength)]]),
   onHeaders(value){status=value;lastHTTP.status=value;lastHTTP.phase='receiving';trace('[vision] HTTP '+value+'\n');},
   onWritable(count){const n=Math.min(count,body.byteLength-offset);if(n){this.write(new DataView(body,offset,n));offset+=n;lastHTTP.uploaded=offset;lastHTTP.phase=offset===body.byteLength?'awaiting-response':'uploading';}},
   onReadable(count){if(done)return;const part=this.read(count);total+=part.byteLength;if(total>65536){finish(new Error('画像認識の応答が大きすぎます'));return;}chunks.push(part);lastHTTP.received=total;},
   onDone(error){if(done)return;try{
    const bytes=new Uint8Array(total);let p=0;for(const b of chunks){bytes.set(new Uint8Array(b),p);p+=b.byteLength;}const text=String.fromArrayBuffer(bytes.buffer);
    if(error||status!==200){let reason='';try{const detail=JSON.parse(text).error;reason=(detail?.details||[]).map(x=>x.reason||'').find(x=>/^[A-Z_]{1,80}$/.test(x))||detail?.status||'';}catch(_){}
     const google=host==='generativelanguage.googleapis.com';let message=reason==='API_KEY_INVALID'||reason==='API_KEY_EXPIRED'?'APIキーが無効または期限切れです。設定画面で確認してください':/REFERRER|IP_ADDRESS|SERVICE_BLOCKED/.test(reason)?'APIキーの利用制限で本体からの接続が拒否されています':status===401||status===403?'APIキーまたは利用権限を確認してください':status===429?'APIの利用上限です。時間をおいてください':status===404?'指定したAIモデルが利用できません':'AIへの通信に失敗しました';
     const failure=new Error((google?'Gemini: ':host==='ollama.com'?'Ollama Cloud: ':'XiaoZhi: ')+message+' (HTTP '+status+')');failure.httpStatus=status;failure.reason=reason;throw failure;
    }
    // A parsed prefix is not a complete HTTP response. Validate only after onDone.
    if(!text.trim())throw new Error('AIからの応答が空です');
    try{const value=JSON.parse(text);if(!value||typeof value!=='object')throw new Error('invalid JSON root');}catch(_){throw new Error('AIの応答JSONを読み取れませんでした');}
    finish(null,text);
   }catch(e){finish(e);}}

  });
 }catch(e){finish(new Error('画像認識サーバーに接続できませんでした'));}
});}
