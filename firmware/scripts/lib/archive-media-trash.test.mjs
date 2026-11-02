import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const {mediaTrash,deletableMedia}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../../host/app/archive-media-trash.js',import.meta.url))).toString('base64'));
function disk(names){
 const data=new Map(names.map(name=>['stackchan/'+name,Uint8Array.from([1,2,3])])),dirs=new Set(['stackchan']);
 return {data,dirs,status(path){if(data.has(path))return{size:data.get(path).length,isFile:()=>true,isDirectory:()=>false};if(dirs.has(path))return{isFile:()=>false,isDirectory:()=>true};throw Error('missing')},scan(path){if(!dirs.has(path))throw Error('missing');return [...data.keys()].filter(key=>key.startsWith(path+'/')).map(key=>key.slice(path.length+1))},createDirectory(path){dirs.add(path)},move(from,to){assert.ok(data.has(from));assert.ok(!data.has(to));data.set(to,data.get(from));data.delete(from)}};
}
test('all generated formats move and restore losslessly; other files stay untouched',()=>{
 for(const name of ['photo-123-0.jpg','photo-123-0.bmp','video-123-0.avi','audio-123-0.wav']){
  const root=disk([name,'event-123.json','memory.sqlite','alarm.mp3']),original=root.data.get('stackchan/'+name);
  assert.equal(mediaTrash(root,'delete',{name}).trashed,true);assert.equal(root.data.has('stackchan/'+name),false);assert.equal(root.data.get('stackchan-trash/'+name),original);
  assert.equal(mediaTrash(root,'delete',{name}).already,true);assert.equal(mediaTrash(root,'list').items[0].name,name);
  assert.equal(mediaTrash(root,'restore',{name}).restored,true);assert.equal(root.data.get('stackchan/'+name),original);assert.equal(mediaTrash(root,'restore',{name}).already,true);assert.equal(root.data.size,4);assert.equal(mediaTrash(root,'list').total,0);
 }
});
test('traversal, DB, transcripts, alarm music and mismatched extensions are rejected',()=>{
 const root=disk(['event-1.json','alarm.mp3']);
 for(const name of ['../photo-1.jpg','/photo-1.jpg','photo-1.jpg/extra','vault.db','event-1.json','alarm.mp3','audio-1.jpg','photo-1.wav','video-1.mp4',null]){assert.equal(deletableMedia(name),false);assert.throws(()=>mediaTrash(root,'delete',{name}));assert.throws(()=>mediaTrash(root,'restore',{name}));}
 assert.equal(root.data.size,2);
});
test('collision refuses overwrite and trash pagination excludes protected files',()=>{
 const root=disk(['photo-1.jpg','photo-2.jpg','photo-3.jpg']);assert.equal(mediaTrash(root,'list').total,0);
 for(const name of ['photo-1.jpg','photo-2.jpg','photo-3.jpg'])mediaTrash(root,'delete',{name});root.data.set('stackchan-trash/secret.json',new Uint8Array([8]));
 const result=mediaTrash(root,'list',{offset:0,limit:2});assert.equal(result.total,3);assert.equal(result.next,2);assert.deepEqual(result.items.map(x=>x.name),['photo-3.jpg','photo-2.jpg']);assert.equal(mediaTrash(root,'list',{offset:2,limit:2}).next,null);
 root.data.set('stackchan/photo-1.jpg',new Uint8Array([9]));assert.throws(()=>mediaTrash(root,'restore',{name:'photo-1.jpg'}));assert.equal(root.data.get('stackchan/photo-1.jpg')[0],9);assert.ok(root.data.has('stackchan-trash/photo-1.jpg'));assert.throws(()=>mediaTrash(root,'list',{offset:-1}));assert.throws(()=>mediaTrash(root,'list',{limit:101}));
});
test('large SD listing is paged below USB limit without losing or duplicating files',async()=>{
 const {mediaFilePage}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL('../../host/app/archive-media-trash.js',import.meta.url))).toString('base64'));
 const names=Array.from({length:1200},(_,i)=>'audio-'+i+'-'+'a'.repeat(180)+'.wav');
 const root=disk([...names,'private.sqlite']);let offset=0,all=[];
 while(true){const page=mediaFilePage(root,'stackchan',name=>name.endsWith('.wav'),{offset,limit:100});assert.ok(Buffer.byteLength(JSON.stringify({id:123,result:page}))<20000);all.push(...page.items.map(x=>x.name));if(page.next===null)break;assert.ok(page.next>offset);offset=page.next;}
 assert.deepEqual(all,names);assert.equal(root.data.size,names.length+1);
 assert.deepEqual(mediaFilePage(root,'stackchan',()=>true,{offset:99999}),{items:[],next:null});
 assert.throws(()=>mediaFilePage(root,'stackchan',()=>true,{offset:-1}));
});
