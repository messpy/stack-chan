import {createHeadJog} from 'archive-head-jog'
import {HEAD_ROTATIONS,moveHead} from 'archive-head-motion'
// LAN diagnostics owns hardware for a short renewable session. No SD/cloud I/O.
export function createLANMonitor(deps) {
  const {robot,claim,release,now,repeat,cancel,token,createInput,convertPCM,speak} = deps
  let session,closing
  const requireSession = id => {
    if (!session || session.id !== id || session.stopping) throw new Error('動作確認を開始し直してください')
    session.seen = now()
    return session
  }
  function closeInput(s) {
    const input=s.input;s.input=null;s.audio=false;s.chunks=[];s.bytes=0
    input?.close()
  }
  function openInput(s) {
    if (!s.audio || s.input || s.stopping) return
    let input
    input=createInput({sampleRate:16000,channels:2,onReadable(){
      if (s.input!==input || s.stopping) return
      try {
        const raw=input.read();if(!raw?.byteLength)return
        const pcm=convertPCM(raw,input.channels).buffer
        if(!pcm?.byteLength || pcm.byteLength>32000)return
        // Keep at most one second; a slow client must not accumulate minutes of sound.
        while(s.bytes+pcm.byteLength>32000 && s.chunks.length)s.bytes-=s.chunks.shift().byteLength
        s.chunks.push(pcm);s.bytes+=pcm.byteLength
      }catch(error){s.error=String(error.message||error);s.audioRequested=false;closeInput(s)}
    }})
    s.input=input
    try{input.start()}catch(error){closeInput(s);throw error}
  }
  function start() {
    if(session || closing)throw new Error('別の動作確認を終了してから開始してください')
    claim()
    try {
      const s={id:token(),seen:now(),audio:false,audioRequested:false,chunks:[],bytes:0,input:null,pending:null,camera:null,stopping:false,error:''}
      session=s
      s.head=createHeadJog(robot,{now,repeat,cancel,log:deps.log})
      if(deps.readHeadRotation) Promise.resolve().then(()=>deps.readHeadRotation()).then(value=>s.head.seed(value)).catch(()=>s.head.fail('首の位置を取得できませんでした。動作確認を開始し直してください'))
      else s.head.seed(robot.pose.body.rotation)
      s.timer=repeat(()=>{if(now()-s.seen>12000)stop(s.id).catch(()=>{});},1000)
      return {id:s.id,sampleRate:16000,channels:1,audio:false}
    }catch(error){session=undefined;release();throw error}
  }
  async function stop(id) {
    if(!session || session.id!==id)throw new Error('動作確認は終了しています')
    if(closing)return closing
    const s=session;s.stopping=true;s.audioRequested=false;cancel(s.timer)
    try{closeInput(s)}catch(_){}
    try{deps.cancelSpeech?.()}catch(_){}
    closing=(async()=>{
      try {
        await s.head.close()
        await Promise.allSettled([s.pending,s.camera].filter(Boolean))
        try{for(const name of Object.keys(robot.led))robot.lightOff(name)}
        finally{await robot.setTorque(false)}
      }finally{session=undefined;closing=undefined;release()}
      return {stopped:true}
    })()
    return closing
  }
  function audio(id,enabled) {
    const s=requireSession(id)
    if(typeof enabled!=='boolean')throw new Error('音声のオン・オフを指定してください')
    if(enabled&&s.pending)throw new Error('本体で操作中です')
    s.audioRequested=enabled
    if(enabled){s.audio=true;try{openInput(s)}catch(error){s.audio=false;s.audioRequested=false;throw error}}
    else closeInput(s)
    return {audio:s.audio,sampleRate:16000}
  }
  function readAudio(id) {
    const s=requireSession(id)
    if(s.error){const error=s.error;s.error='';throw new Error(error)}
    const result=new Uint8Array(s.bytes);let offset=0
    for(const chunk of s.chunks){result.set(new Uint8Array(chunk),offset);offset+=chunk.byteLength}
    s.chunks=[];s.bytes=0
    return result.buffer
  }
  function status(id) {
    const s=requireSession(id)
    return {active:true,audio:s.audio,speaking:!!s.pending,error:s.error,bufferedMs:s.bytes/32,head:s.head.state()}
  }
  async function frame(id) {
    const s=requireSession(id)
    if(s.camera)throw new Error('カメラを更新中です')
    s.camera=(async()=>{
      let frame
      try {
        frame=await robot.camera.capture({width:176,height:144,imageType:'rgb565le'})
        if(!frame)throw new Error('カメラの画像を取得できませんでした')
        return deps.jpeg(frame.buffer,frame.width,frame.height,frame.imageType==='rgb565le')
      }finally{try{frame?.close?.()}finally{robot.camera.stop()}}
    })()
    try{return await s.camera}finally{s.camera=null}
  }
  async function command(id,op,args={}) {
    const s=requireSession(id)
    if(op==='pose_hold') {
      if(s.pending&&args.held)throw new Error('本体で操作中です')
      return s.head.hold(args)
    }
    if(s.pending)throw new Error('本体で操作中です')
    if(op==='pose'||op==='speak')s.head.stop()
    // Validate before touching hardware.
    const directions=HEAD_ROTATIONS
    if(op==='pose'&&!Object.hasOwn(directions,args.direction))throw new Error('向きを選んでください')
    if(op==='led'&&(!['color','rainbow','off'].includes(args.mode)||args.mode==='color'&&!/^[#][0-9a-f]{6}$/i.test(args.color||'')))throw new Error('LEDの色を選んでください')
    if(op==='speak'&&(typeof args.text!=='string'||!args.text.trim()||args.text.length>200))throw new Error('読み上げる文字は1〜200文字で入力してください')
    if(op==='speak'&&args.subtitles!==undefined&&typeof args.subtitles!=='boolean')throw new Error('字幕のオン・オフを指定してください')
    if(!['pose','led','speak'].includes(op))throw new Error('動作を選んでください')
    s.pending=(async()=>{
      if(op==='pose') {
        await moveHead(robot,args)
        s.head.reset(HEAD_ROTATIONS[args.direction])
        return {direction:args.direction}
      }
      if(op==='led') {
        const names=Object.keys(robot.led);if(!names.length)throw new Error('LEDが見つかりません')
        for(const name of names){
          if(args.mode==='off')robot.lightOff(name)
          else if(args.mode==='rainbow')robot.lightRainbow(name)
          else {const rgb=parseInt(args.color.slice(1),16);robot.lightOn(name,((rgb>>16)&255)>>2,((rgb>>8)&255)>>2,(rgb&255)>>2)}
        }
        return {mode:args.mode,color:args.color}
      }
      closeInput(s) // I2S input/output share hardware; never open both here.
      try{
        robot.hideBalloon();if(args.subtitles===true)robot.showBalloon(args.text.trim(),{bottom:40})
        await speak(args.text.trim(),{subtitles:args.subtitles===true});return {spoken:true}
      }finally{try{robot.hideBalloon()}finally{s.audio=s.audioRequested;if(!s.stopping)openInput(s)}}
    })()
    try{return await s.pending}finally{s.pending=null}
  }
  return {start,stop,stopCurrent:()=>session?stop(session.id):Promise.resolve({stopped:true}),audio,readAudio,status,frame,command,get active(){return !!session}}
}
