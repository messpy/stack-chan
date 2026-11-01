import {withSDCard} from 'stackchan-sdcard';
import {randomHex,getSettings} from 'archive-vault';
const run=native('xs_archive_database');
let ready=false,activeSpeaker=null,guestSpeaker=false,activeProfile=null;
function mounted(fn){return withSDCard(root=>{try{root.createDirectory('stackchan');}catch(_){}return fn();});}
function initialize(){if(ready)return;mounted(()=>{
  run('PRAGMA journal_mode=PERSIST',[]);run('PRAGMA synchronous=FULL',[]);run('PRAGMA temp_store=MEMORY',[]);
  run('CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT \'person\',nicknames TEXT NOT NULL DEFAULT \'[]\',likes TEXT NOT NULL DEFAULT \'[]\',about TEXT NOT NULL DEFAULT \'\',updated_at INTEGER NOT NULL)',[]);
  run("CREATE TABLE IF NOT EXISTS name_readings(user_id TEXT PRIMARY KEY,reading TEXT NOT NULL)",[]);
  run('CREATE INDEX IF NOT EXISTS users_name ON entities(name COLLATE NOCASE)',[]);
  run('CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,role TEXT NOT NULL,text TEXT NOT NULL,created INTEGER NOT NULL,speaker_id TEXT)',[]);
  run('CREATE TABLE IF NOT EXISTS message_context(message_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(message_id,user_id))',[]);
  run('CREATE TABLE IF NOT EXISTS message_media(message_id TEXT PRIMARY KEY,filename TEXT NOT NULL)',[]);
  run('CREATE INDEX IF NOT EXISTS messages_created ON messages(created DESC)',[]);
  run('CREATE INDEX IF NOT EXISTS messages_speaker_time ON messages(speaker_id,created DESC)',[]);
  run('CREATE INDEX IF NOT EXISTS message_context_user ON message_context(user_id,message_id)',[]);
  run('CREATE TABLE IF NOT EXISTS user_evidence(user_id TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(user_id,message_id))',[]);
  run('CREATE TABLE IF NOT EXISTS profile_details(user_id TEXT PRIMARY KEY,stackchan_name TEXT NOT NULL DEFAULT \'\',family TEXT NOT NULL DEFAULT \'\',hobbies TEXT NOT NULL DEFAULT \'\',location TEXT NOT NULL DEFAULT \'\')',[]);
  run('CREATE VIEW IF NOT EXISTS user_profile AS SELECT e.*,d.stackchan_name,d.family,d.hobbies,d.location FROM entities e LEFT JOIN profile_details d ON d.user_id=e.id',[]);
  run('CREATE VIEW IF NOT EXISTS talk_history AS SELECT m.*,c.user_id AS user FROM messages m LEFT JOIN message_context c ON c.message_id=m.id',[]);
  run('CREATE VIEW IF NOT EXISTS users AS SELECT * FROM entities',[]);
  run('INSERT OR IGNORE INTO entities(id,name,kind,nicknames,likes,about,updated_at) VALUES(?,?,?,?,?,?,?)',['stackchan-self','StackChan','robot',JSON.stringify(['スタックちゃん']),'[]','',Date.now()]);
  run('CREATE TABLE IF NOT EXISTS memory_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)',[]);
});ready=true;}
function db(sql,args=[]){initialize();return mounted(()=>run(sql,args));}
function text(value,max=512){return typeof value==='string'?value.trim().slice(0,max):'';}
function profile(row){return {...row,lastConversation:row.lastConversation||null,nicknames:JSON.parse(row.nicknames),likes:JSON.parse(row.likes)};}
export function beginConversation(){activeSpeaker=null;guestSpeaker=false;activeProfile=null;}
export function currentSpeaker(){if(guestSpeaker)return {guest:true};if(!activeSpeaker)return null;if(!activeProfile)activeProfile=users({id:activeSpeaker}).users[0]||null;return activeProfile;}
// Kana-based matching stays local; kanji readings are supplied by the AI tool.
export function nameReading(value){
  let name=String(value||'').trim();
  // XS exposes normalize() even when Unicode normalization is not built in.
  // Do not call it: Japanese input then throws RangeError("not built-in").
  const half='ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
  const full='ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';
  name=name.replace(/[ｦ-ﾝ]/g,c=>full[half.indexOf(c)]);

  name=name.replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)).replace(/[\s・･]/g,'').replace(/(?:さん|くん|ちゃん)$/,'');
  name=name.replace(/([ぁ-ゖ])[ﾞﾟ\u3099\u309a]/g,(whole,base)=>{
    const semi=/[ﾟ\u309a]$/.test(whole),from=semi?'はひふへほ':'かきくけこさしすせそたちつてとはひふへほう',to=semi?'ぱぴぷぺぽ':'がぎぐげござじずぜぞだぢづでどばびぶべぼゔ';
    const index=from.indexOf(base);return index<0?whole:to[index];
  });
  return /^[ぁ-ゖー]+$/.test(name)?name:'';
}
function distance(a,b){
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next[j+1]=Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]===b[j]?0:1));row=next;}
  return row[b.length];
}
function vowels(value){
  const groups=['あかがさざただなはばぱまゃやらわぁ','いきぎしじちぢにひびぴみりぃ','うくぐすずつづぬふぶぷむゅゆるぅ','えけげせぜてでねへべぺめれぇ','おこごそぞとどのほぼぽもょよろをぉ'];
  return Array.from(value,c=>c==='ん'?'N':c==='っ'?'Q':c==='ー'?'':String(groups.findIndex(g=>g.includes(c)))).join('');
}
export function nameSimilarity(left,right){
  const a=nameReading(left),b=nameReading(right);if(!a||!b)return 0;
  if(a===b)return 1;
  if(Math.min(a.length,b.length)<3||Math.abs(a.length-b.length)>1||distance(a,b)!==1)return 0;
  // A vowel pattern alone is insufficient: allow only one changed kana,
  // or a trailing long vowel, with the remaining kana preserved.
  if(a.length===b.length&&vowels(a)===vowels(b))return .86;
  const long=a.length>b.length?a:b,short=a.length>b.length?b:a;
  if(long.slice(0,-1)===short&&/[うおー]$/.test(long))return .86;
  return .55;
}
export function identifySpeaker(args){
  if(args?.guest===true){activeSpeaker=null;activeProfile=null;guestSpeaker=true;return {identified:false,guest:true};}
  const name=text(args?.name,80);if(!name)throw new Error('本人の名前を確認してください');
  const reading=nameReading(args.name_reading||name);
  if(/[一-龯]/.test(name)&&!reading&&!args.id)throw new Error('漢字の推測表記で登録せず、本人の名前をひらがなのname_readingで渡してください');
  const people=users(args.id?{id:args.id}:{limit:50}).users.filter(p=>p.kind==='person');
  const exact=p=>p.name.toLowerCase()===name.toLowerCase()||p.nicknames.some(n=>n.toLowerCase()===name.toLowerCase());
  const readingMatches=reading?people.filter(p=>[p.name_reading,p.name,...p.nicknames].some(n=>nameSimilarity(reading,n)===1)):[];
  let matches=args.id?people.filter(p=>p.id===args.id):(readingMatches.length?readingMatches:people.filter(exact));
  if(args.id&&!matches.length)throw new Error('人物IDが見つかりません');
  if(!matches.length&&reading){
    const ranked=people.map(person=>({person,score:Math.max(...[person.name_reading,person.name,...person.nicknames].map(n=>nameSimilarity(reading,n)))})).filter(p=>p.score>0).sort((a,b)=>b.score-a.score);
    if(ranked.length&&ranked[0].score>=.86&&(!ranked[1]||ranked[0].score-ranked[1].score>=.1))matches=[ranked[0].person];
    else if(ranked.length)return {identified:false,needsConfirmation:true,candidates:ranked.slice(0,3).map(p=>({id:p.person.id,name:p.person.name,name_reading:p.person.name_reading})),instruction:'候補を本人に確認し、正しい人物IDで呼び直してください。新規登録しないでください。'};
  }
  if(matches.length>1)return {identified:false,needsConfirmation:true,candidates:matches.map(p=>({id:p.id,name:p.name})),instruction:'同名候補を確認して人物IDを指定してください'};
  if(!matches.length&&users({name}).users.some(p=>p.kind==='robot'))throw new Error('本体とは別の名前を確認してください');
  let person=matches[0]||saveUser({name:reading||name,name_reading:reading||undefined,nicknames:reading&&reading!==name?[name]:[],kind:'person',source_message_ids:args.source_message_id?[args.source_message_id]:[]}).users[0];
  if(matches.length&&args.name_reading&&reading){
    const canonical=nameReading(person.name)===person.name?person.name:reading;
    if(person.name!==canonical||person.name_reading!==canonical)person=saveUser({id:person.id,name:canonical,name_reading:canonical,nicknames:[...person.nicknames,...(person.name!==canonical?[person.name]:[])]}).users[0];
  }
  activeSpeaker=person.id;activeProfile=person;guestSpeaker=false;
  if(args.source_message_id){const source=text(args.source_message_id,100);db('UPDATE messages SET speaker_id=? WHERE id=? AND role=?',[person.id,source,'user']);db('INSERT OR IGNORE INTO message_context(message_id,user_id) SELECT id,? FROM messages WHERE id=?',[person.id,source]);}
  return {identified:true,instruction:'話者は確定しました。名前を聞き直したり再確認せず、名前を呼んで短く挨拶し通常会話へ進んでください。',newUser:!matches.length,person,now:Date.now(),timezone:'Asia/Tokyo',recent:history({user_id:person.id,limit:3}).items};
}
export function recordMemory(event){const owner=Object.hasOwn(event,'speakerId')?event.speakerId:activeSpeaker;if(owner===activeSpeaker&&activeProfile&&event.created>(activeProfile.lastConversation||0))activeProfile.lastConversation=event.created;db('INSERT OR IGNORE INTO messages(id,role,text,created,speaker_id) VALUES(?,?,?,?,?)',[event.id,event.role,event.text,event.created,event.role==='assistant'?'stackchan-self':owner]);if(owner)db('INSERT OR IGNORE INTO message_context(message_id,user_id) VALUES(?,?)',[event.id,owner]);if(typeof event.image==='string'&&/^photo-[a-z0-9-]+\.jpg$/.test(event.image))db('INSERT OR REPLACE INTO message_media(message_id,filename) VALUES(?,?)',[event.id,event.image]);}
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
export function deviceHistory(args={}){
  const limit=Math.max(1,Math.min(10,Math.floor(Number(args.limit)||10))),where=[],values=[];
  if(args.user_id){where.push('(m.speaker_id=? OR EXISTS(SELECT 1 FROM message_context c WHERE c.message_id=m.id AND c.user_id=?))');values.push(text(args.user_id,64),text(args.user_id,64));}

  const rows=db('SELECT m.id,m.role,substr(m.text,1,4096) AS text,m.created,(SELECT name FROM entities WHERE id=m.speaker_id) AS name,(SELECT name FROM entities WHERE id=(SELECT user_id FROM message_context WHERE message_id=m.id LIMIT 1)) AS partner FROM messages m'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY m.created DESC,m.id DESC LIMIT ?',values.concat(limit));
  return {items:rows};
}

export function users(args={}){
  const name=text(args.name,80),id=text(args.id,64);let rows;
  const base='SELECT p.*,(SELECT reading FROM name_readings WHERE user_id=p.id) AS name_reading,NULLIF(max(COALESCE((SELECT MAX(created) FROM messages WHERE speaker_id=p.id),0),COALESCE((SELECT MAX(m.created) FROM message_context c JOIN messages m ON m.id=c.message_id WHERE c.user_id=p.id),0)),0) AS lastConversation FROM user_profile p';
  if(id)rows=db(base+' WHERE p.id=? LIMIT 5',[id]);
  else if(name)rows=db(base+' WHERE name LIKE ? OR nicknames LIKE ? ORDER BY updated_at DESC LIMIT 5',['%'+name+'%','%'+name+'%']);
  else rows=db(base+' ORDER BY lastConversation DESC,updated_at DESC LIMIT ?',[Math.min(50,Math.max(1,Number(args.limit)||5))]);
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
    const reading=nameReading(args.name_reading||(!old?name:''));
    if(args.name_reading!==undefined&&!reading)throw new Error('読みはひらがなで入力してください');
    if(reading)db('INSERT OR REPLACE INTO name_readings(user_id,reading) VALUES(?,?)',[id,reading]);
    const fields=['stackchan_name','family','hobbies','location'];
    if(fields.some(k=>args[k]!==undefined)){const oldDetails=db('SELECT * FROM profile_details WHERE user_id=?',[id])[0]||{};db('INSERT OR REPLACE INTO profile_details(user_id,stackchan_name,family,hobbies,location) VALUES(?,?,?,?,?)',[id,...fields.map(k=>args[k]===undefined?(oldDetails[k]||''):text(args[k],240))]);}
    for(const source of strings(args.source_message_ids).slice(0,8))if(db('SELECT id FROM messages WHERE id=?',[source]).length)db('INSERT OR IGNORE INTO user_evidence(user_id,message_id) VALUES(?,?)',[id,source]);
    db('COMMIT');
  }catch(error){db('ROLLBACK');throw error;}
  const saved=users({id});if(activeSpeaker===id)activeProfile=saved.users[0]||null;return saved;
}
export function memoryStatus(){return {messages:db('SELECT count(*) AS count FROM messages')[0].count,users:db('SELECT count(*) AS count FROM entities')[0].count,integrity:db('PRAGMA quick_check')[0].quick_check};}
export function importLegacy(){
  if(db('SELECT value FROM memory_meta WHERE key=?',['legacy-imported']).length)return;
  const names=withSDCard(root=>Array.from(root.scan('stackchan')).filter(name=>/^chat-[a-z0-9-]+\.json$/.test(name)));
  for(const name of names){
    let event;
    withSDCard(root=>{const file=root.openFile({path:'stackchan/'+name,mode:'r'});try{if(file.status().size<=20000)event=JSON.parse(String.fromArrayBuffer(file.read(file.status().size,0)));}catch(_){}finally{file.close();}});
    if(event?.id&&event?.text)recordMemory({...event,speakerId:Object.hasOwn(event,'speakerId')?event.speakerId:null});
  }
  db('INSERT OR REPLACE INTO memory_meta(key,value) VALUES(?,?)',['legacy-imported','1']);
}
export const memoryTools=[
 {name:'conversation_identify',description:'新しい会話はまず「あなたは誰？お名前を教えて」と本人の名前を尋ねる。本人が名乗った後、名前を漢字に推測変換せずひらがなのname_readingを必ず添えてこの道具で現在の話者を確定し、その後に通常の会話へ進む。第三者の名前や推測で確定しない。同名候補が複数なら本人に確認する。返った本人プロフィールを参照できるが、音声による本人認証ではない。',inputSchema:{type:'object',properties:{name:{type:'string'},name_reading:{type:'string',description:'本人が言った名前のひらがなの読み。漢字表記は推測しない'},id:{type:'string'},guest:{type:'boolean',description:'本人が名前を名乗りたくないと明示した場合のみtrue'}},additionalProperties:false}},
 {name:'conversation_history',description:'必要な会話だけをSDから検索する。queryでキーワード、minutes_ago:60で約1時間前（前後10分）を指定できる。全履歴を一括取得しない。',inputSchema:{type:'object',properties:{query:{type:'string'},minutes_ago:{type:'number'},window_minutes:{type:'number'},after:{type:'string'},before:{type:'string'},user_id:{type:'string'},limit:{type:'integer',minimum:1,maximum:10}},additionalProperties:false}},
 {name:'user_lookup',description:'会話に登場する人物を名前・ニックネーム・人物IDで探し、プロフィールのみ取得する。会話本文は含まない。曖昧な人物は確認する。',inputSchema:{type:'object',properties:{name:{type:'string'},id:{type:'string'}},additionalProperties:false}},
 {name:'user_remember',description:'会話で明示された人物の名前、ニックネーム、好み、人柄などをusersへ保存・訂正する。推測を事実として保存しない。既存人物はuser_lookupで確認してIDを指定し、更新する配列は現在の内容を含めて渡す。source_message_idsに根拠となる会話IDを付ける。',inputSchema:{type:'object',properties:{id:{type:'string'},name:{type:'string'},name_reading:{type:'string'},kind:{type:'string',enum:['person','robot']},nicknames:{type:'array',items:{type:'string'}},likes:{type:'array',items:{type:'string'}},about:{type:'string'},stackchan_name:{type:'string'},family:{type:'string'},hobbies:{type:'string'},location:{type:'string'},source_message_ids:{type:'array',items:{type:'string'}}},required:['name'],additionalProperties:false}}
];
export function callMemory(name,args){if(name==='conversation_identify')return identifySpeaker(args);if(name==='conversation_history')return history(args);if(name==='user_lookup')return users(args);if(name==='user_remember')return saveUser(args);throw new Error('Unknown memory tool');}

export function memoryFileStatus(){return withSDCard(root=>{const file=root.openFile({path:'stackchan/memory.sqlite3',mode:'r'});try{const size=file.status().size,bytes=new Uint8Array(file.read(Math.min(size,100),0));const magic=[83,81,76,105,116,101,32,102,111,114,109,97,116,32,51,0];const valid=magic.every((v,i)=>bytes[i]===v);return {bytes:size,signature:valid,pageSize:valid?((bytes[16]<<8)|bytes[17]):0,readVersion:valid?bytes[19]:0,writeVersion:valid?bytes[18]:0};}finally{file.close();}});}
export function preserveInvalidMemory(){
  mounted(()=>native('xs_archive_database_close')());ready=false;
  return withSDCard(root=>{const stamp=Date.now();for(const suffix of ['', '-journal']){const path='stackchan/memory.sqlite3'+suffix;try{root.status(path);root.move(path,'stackchan/memory-backup-'+stamp+'.sqlite3'+suffix);}catch(_){}}return {preserved:true};});
}
