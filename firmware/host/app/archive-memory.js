import {withSDCard} from 'stackchan-sdcard';
import {randomHex,getSettings} from 'archive-vault';
const run=native('xs_archive_database');
let ready=false,activeSpeaker=null,guestSpeaker=false;
function mounted(fn){return withSDCard(root=>{try{root.createDirectory('stackchan');}catch(_){}return fn();});}
function initialize(){if(ready)return;mounted(()=>{
  run('PRAGMA journal_mode=PERSIST',[]);run('PRAGMA synchronous=FULL',[]);run('PRAGMA temp_store=MEMORY',[]);
  run('CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT \'person\',nicknames TEXT NOT NULL DEFAULT \'[]\',likes TEXT NOT NULL DEFAULT \'[]\',about TEXT NOT NULL DEFAULT \'\',updated_at INTEGER NOT NULL)',[]);
  run('CREATE INDEX IF NOT EXISTS users_name ON entities(name COLLATE NOCASE)',[]);
  run('CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,role TEXT NOT NULL,text TEXT NOT NULL,created INTEGER NOT NULL,speaker_id TEXT)',[]);
  run('CREATE TABLE IF NOT EXISTS message_context(message_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(message_id,user_id))',[]);
  run('CREATE TABLE IF NOT EXISTS message_media(message_id TEXT PRIMARY KEY,filename TEXT NOT NULL)',[]);
  run('CREATE INDEX IF NOT EXISTS messages_created ON messages(created DESC)',[]);
  run('CREATE TABLE IF NOT EXISTS user_evidence(user_id TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(user_id,message_id))',[]);
  run('CREATE VIEW IF NOT EXISTS users AS SELECT * FROM entities',[]);
  run('INSERT OR IGNORE INTO entities(id,name,kind,nicknames,likes,about,updated_at) VALUES(?,?,?,?,?,?,?)',['stackchan-self','StackChan','robot',JSON.stringify(['スタックちゃん']),'[]','',Date.now()]);
  run('CREATE TABLE IF NOT EXISTS memory_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)',[]);
});ready=true;}
function db(sql,args=[]){initialize();return mounted(()=>run(sql,args));}
function text(value,max=512){return typeof value==='string'?value.trim().slice(0,max):'';}
function profile(row){return {...row,nicknames:JSON.parse(row.nicknames),likes:JSON.parse(row.likes)};}
export function beginConversation(){activeSpeaker=null;guestSpeaker=false;}
export function currentSpeaker(){if(guestSpeaker)return {guest:true};return activeSpeaker?users({id:activeSpeaker}).users[0]||null:null;}
export function identifySpeaker(args){
  if(args?.guest===true){activeSpeaker=null;guestSpeaker=true;return {identified:false,guest:true};}
  const name=text(args?.name,80);if(!name)throw new Error('本人の名前を確認してください');
  let matches=users(args.id?{id:args.id}:{name}).users.filter(p=>p.kind==='person'&&(p.name.toLowerCase()===name.toLowerCase()||p.nicknames.some(n=>n.toLowerCase()===name.toLowerCase())));
  if(matches.length>1)throw new Error('同名の人物が複数います。本人に確認して人物IDを指定してください');
  if(args.id&&!matches.length)throw new Error('人物IDと名前が一致しません');
  const person=matches[0]||saveUser({name,kind:'person',source_message_ids:args.source_message_id?[args.source_message_id]:[]}).users[0];
  activeSpeaker=person.id;guestSpeaker=false;
  if(args.source_message_id)db('UPDATE messages SET speaker_id=? WHERE id=? AND role=?',[person.id,text(args.source_message_id,100),'user']);
  return {identified:true,person};
}
export function recordMemory(event){db('INSERT OR IGNORE INTO messages(id,role,text,created,speaker_id) VALUES(?,?,?,?,?)',[event.id,event.role,event.text,event.created,event.role==='assistant'?'stackchan-self':activeSpeaker]);if(activeSpeaker)db('INSERT OR IGNORE INTO message_context(message_id,user_id) VALUES(?,?)',[event.id,activeSpeaker]);if(typeof event.image==='string'&&/^photo-[a-z0-9-]+\.jpg$/.test(event.image))db('INSERT OR REPLACE INTO message_media(message_id,filename) VALUES(?,?)',[event.id,event.image]);}
export function history(args={}){
  const limit=Math.max(1,Math.min(10,Math.floor(Number(args.limit)||5))),where=[],values=[];
  if(args.query){where.push('text LIKE ?');values.push('%'+text(args.query,120)+'%');}
  if(args.minutes_ago!==undefined){const minutes=Number(args.minutes_ago);if(!Number.isFinite(minutes)||minutes<0||minutes>5256000)throw new Error('Invalid time range');const target=Date.now()-minutes*60000,window=Math.min(60,Math.max(1,Number(args.window_minutes)||10))*60000;where.push('created BETWEEN ? AND ?');values.push(target-window,target+window);}
  if(args.after){const value=Date.parse(args.after);if(!Number.isFinite(value))throw new Error('Invalid after');where.push('created>=?');values.push(value);}
  if(args.before){const value=Date.parse(args.before);if(!Number.isFinite(value))throw new Error('Invalid before');where.push('created<=?');values.push(value);}
  if(args.user_id){where.push('(speaker_id=? OR id IN (SELECT message_id FROM user_evidence WHERE user_id=?) OR id IN (SELECT message_id FROM message_context WHERE user_id=?))');values.push(text(args.user_id,64),text(args.user_id,64),text(args.user_id,64));}
  const rows=db('SELECT id,role,substr(text,1,360) AS text,created,speaker_id,(SELECT filename FROM message_media WHERE message_id=messages.id) AS image FROM messages'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY created DESC LIMIT ?',values.concat(limit));
  return {items:rows.reverse(),timezone:'Asia/Tokyo',now:Date.now()};
}
export function users(args={}){
  const name=text(args.name,80),id=text(args.id,64);let rows;
  if(id)rows=db('SELECT * FROM entities WHERE id=? LIMIT 5',[id]);
  else if(name)rows=db('SELECT * FROM entities WHERE name LIKE ? OR nicknames LIKE ? ORDER BY updated_at DESC LIMIT 5',['%'+name+'%','%'+name+'%']);
  else rows=db('SELECT * FROM entities ORDER BY updated_at DESC LIMIT ?',[Math.min(50,Math.max(1,Number(args.limit)||5))]);
  return {users:rows.map(profile)};
}
function strings(value){if(!Array.isArray(value))return [];return [...new Set(value.map(v=>text(v,80)).filter(Boolean))].slice(0,20);}
export function saveUser(args){
  const name=text(args.name,80);if(!name)throw new Error('名前が必要です');let id=text(args.id,64);
  if(id&&!/^[a-zA-Z0-9-]{1,64}$/.test(id))throw new Error('Invalid user ID');
  if(!id){const matches=db('SELECT id FROM entities WHERE name=? COLLATE NOCASE LIMIT 3',[name]);if(matches.length>1)throw new Error('同じ名前が複数あります。人物IDを指定してください');id=matches[0]?.id||randomHex();}
  const old=db('SELECT * FROM entities WHERE id=?',[id])[0];
  const nicknames=args.nicknames===undefined?(old?JSON.parse(old.nicknames):[]):strings(args.nicknames);
  const likes=args.likes===undefined?(old?JSON.parse(old.likes):[]):strings(args.likes);
  const kind=args.kind===undefined?(old?.kind||'person'):args.kind;if(kind!=='person'&&kind!=='robot')throw new Error('Invalid entity kind');
  const about=args.about===undefined?(old?.about||''):text(args.about,1000);
  db('BEGIN IMMEDIATE');try{
    db('INSERT INTO entities(id,name,kind,nicknames,likes,about,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,nicknames=excluded.nicknames,likes=excluded.likes,about=excluded.about,updated_at=excluded.updated_at',[id,name,kind,JSON.stringify(nicknames),JSON.stringify(likes),about,Date.now()]);
    for(const source of strings(args.source_message_ids).slice(0,8))if(db('SELECT id FROM messages WHERE id=?',[source]).length)db('INSERT OR IGNORE INTO user_evidence(user_id,message_id) VALUES(?,?)',[id,source]);
    db('COMMIT');
  }catch(error){db('ROLLBACK');throw error;}
  return users({id});
}
export function memoryStatus(){return {messages:db('SELECT count(*) AS count FROM messages')[0].count,users:db('SELECT count(*) AS count FROM entities')[0].count,integrity:db('PRAGMA quick_check')[0].quick_check};}
export function importLegacy(){
  if(db('SELECT value FROM memory_meta WHERE key=?',['legacy-imported']).length)return;
  const names=withSDCard(root=>Array.from(root.scan('stackchan')).filter(name=>/^chat-[a-z0-9-]+\.json$/.test(name)));
  for(const name of names){
    let event;
    withSDCard(root=>{const file=root.openFile({path:'stackchan/'+name,mode:'r'});try{if(file.status().size<=20000)event=JSON.parse(String.fromArrayBuffer(file.read(file.status().size,0)));}catch(_){}finally{file.close();}});
    if(event?.id&&event?.text)recordMemory(event);
  }
  db('INSERT OR REPLACE INTO memory_meta(key,value) VALUES(?,?)',['legacy-imported','1']);
}
export const memoryTools=[
 {name:'conversation_identify',description:'新しい会話はまず「あなたは誰？お名前を教えて」と本人の名前を尋ねる。本人が名乗った後にこの道具で現在の話者を確定し、その後に通常の会話へ進む。第三者の名前や推測で確定しない。同名候補が複数なら本人に確認する。返った本人プロフィールを参照できるが、音声による本人認証ではない。',inputSchema:{type:'object',properties:{name:{type:'string'},id:{type:'string'},guest:{type:'boolean',description:'本人が名前を名乗りたくないと明示した場合のみtrue'}},additionalProperties:false}},
 {name:'conversation_history',description:'必要な会話だけをSDから検索する。queryでキーワード、minutes_ago:60で約1時間前（前後10分）を指定できる。全履歴を一括取得しない。',inputSchema:{type:'object',properties:{query:{type:'string'},minutes_ago:{type:'number'},window_minutes:{type:'number'},after:{type:'string'},before:{type:'string'},user_id:{type:'string'},limit:{type:'integer',minimum:1,maximum:10}},additionalProperties:false}},
 {name:'user_lookup',description:'会話に登場する人物を名前・ニックネーム・人物IDで探し、プロフィールのみ取得する。会話本文は含まない。曖昧な人物は確認する。',inputSchema:{type:'object',properties:{name:{type:'string'},id:{type:'string'}},additionalProperties:false}},
 {name:'user_remember',description:'会話で明示された人物の名前、ニックネーム、好み、人柄などをusersへ保存・訂正する。推測を事実として保存しない。既存人物はuser_lookupで確認してIDを指定し、更新する配列は現在の内容を含めて渡す。source_message_idsに根拠となる会話IDを付ける。',inputSchema:{type:'object',properties:{id:{type:'string'},name:{type:'string'},kind:{type:'string',enum:['person','robot']},nicknames:{type:'array',items:{type:'string'}},likes:{type:'array',items:{type:'string'}},about:{type:'string'},source_message_ids:{type:'array',items:{type:'string'}}},required:['name'],additionalProperties:false}}
];
export function callMemory(name,args){if(name==='conversation_identify')return identifySpeaker(args);if(name==='conversation_history')return history(args);if(name==='user_lookup')return users(args);if(name==='user_remember')return saveUser(args);throw new Error('Unknown memory tool');}

export function memoryFileStatus(){return withSDCard(root=>{const file=root.openFile({path:'stackchan/memory.sqlite3',mode:'r'});try{const size=file.status().size,bytes=new Uint8Array(file.read(Math.min(size,100),0));const magic=[83,81,76,105,116,101,32,102,111,114,109,97,116,32,51,0];const valid=magic.every((v,i)=>bytes[i]===v);return {bytes:size,signature:valid,pageSize:valid?((bytes[16]<<8)|bytes[17]):0,readVersion:valid?bytes[19]:0,writeVersion:valid?bytes[18]:0};}finally{file.close();}});}
export function preserveInvalidMemory(){
  mounted(()=>native('xs_archive_database_close')());ready=false;
  return withSDCard(root=>{const stamp=Date.now();for(const suffix of ['', '-journal']){const path='stackchan/memory.sqlite3'+suffix;try{root.status(path);root.move(path,'stackchan/memory-backup-'+stamp+'.sqlite3'+suffix);}catch(_){}}return {preserved:true};});
}
