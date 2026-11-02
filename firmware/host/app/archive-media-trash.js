// Only generated media may be moved. Settings, DBs, transcripts and alarm music stay untouched.
export const deletableMedia = name => typeof name==='string' && /^(?:photo-[a-z0-9-]+\.(?:jpg|bmp)|video-[a-z0-9-]+\.avi|audio-[a-z0-9-]+\.wav)$/.test(name)
export function mediaTrash(root,action,args={}) {
 const folder='stackchan',trash='stackchan-trash'
 const exists=path=>{try{return root.status(path).isFile()}catch(_){return false}}
 if(action==='list') {
  const offset=args.offset??0,limit=args.limit??50
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw new Error('一覧の範囲が不正です')
  let names=[]
  try{names=Array.from(root.scan(trash)).filter(deletableMedia).sort().reverse()}catch(error){try{root.status(trash)}catch(_){return {items:[],total:0,next:null}}throw error}
  const items=names.slice(offset,offset+limit).filter(name=>exists(trash+'/'+name)).map(name=>({name,size:root.status(trash+'/'+name).size}))
  return {items,total:names.length,next:offset+limit<names.length?offset+limit:null}
 }
 if(!['delete','restore'].includes(action)||!deletableMedia(args.name))throw new Error('削除できる写真・動画・録音を選んでください')
 const name=args.name,original=folder+'/'+name,deleted=trash+'/'+name
 const from=action==='delete'?original:deleted,to=action==='delete'?deleted:original
 if(!exists(from)) {
  if(exists(to))return {name,trashed:action==='delete',restored:action==='restore',already:true,size:root.status(to).size}
  throw new Error('ファイルが見つかりません')
 }
 if(exists(to))throw new Error('同じ名前のファイルがあるため移動できません')
 const directory=action==='delete'?trash:folder
 try{root.createDirectory(directory)}catch(error){if(!root.status(directory).isDirectory())throw error}
 root.move(from,to)
 return {name,trashed:action==='delete',restored:action==='restore',size:root.status(to).size}
}

// Keep each USB response bounded even as recordings and transcripts accumulate.
export function mediaFilePage(root,folder,safe,args={}) {
 const offset=args.offset??0,limit=args.limit??50;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw new Error('一覧の範囲が不正です');
 const items=[];let index=0,bytes=0;
 for(const name of root.scan(folder)){
  if(!safe(name))continue;
  const stat=root.status(folder+'/'+name);if(!stat.isFile())continue;
  if(index++<offset)continue;
  const item={name,size:stat.size},cost=JSON.stringify(item).length*3+3;
  if(items.length>=limit||bytes+cost>12000){
   if(!items.length)throw new Error('ファイル名が長すぎます');
   return {items,next:offset+items.length};
  }
  items.push(item);bytes+=cost;
 }
 return {items,next:null};
}
