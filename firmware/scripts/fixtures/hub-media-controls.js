// External PC hub compatibility fixture; not a bundled PC hub implementation.
// Captured from kmac hub/index.html media controls on 2026-11-08.
// Original fragment SHA256: 6fcec5bf71bd2ff3cf0b3a8b159e3c6042fb4ccb32b11fa0b67f091905d6bc3c
// CI validates this frozen contract; live external hub E2E remains separate.
const deletableMediaName=name=>/^(?:photo-[a-z0-9-]+[.](?:jpg|bmp)|video-[a-z0-9-]+[.]avi|audio-[a-z0-9-]+[.]wav)$/.test(name);
let mediaEditing=false,trashLoading=false,trashNext=null;
async function editMedia(action,name,button){
 if(mediaEditing)return;
 if(action==='delete'&&!confirm(name+'を本体SDとPCのごみ箱へ移動しますか？ 後から復元できます。'))return;
 mediaEditing=true;button.disabled=true;
 try{await api('/api/media/'+action,{name});$('notice').textContent=action==='delete'?'ごみ箱へ移動しました。':'復元しました。';await refresh();await loadTrash();}
 catch(error){$('notice').textContent=error.message;}
 finally{mediaEditing=false;button.disabled=false;}
}
async function loadTrash(append=false){
 if(trashLoading)return;trashLoading=true;
 try{const result=await api('/api/media/trash?offset='+(append?(trashNext||0):0));if(!append)$('trashItems').replaceChildren();
  for(const item of result.items){const row=node('article'),label=node('p',item.name),restore=node('button','復元');restore.onclick=()=>editMedia('restore',item.name,restore);row.append(label,restore);$('trashItems').append(row);}
  if(!result.total)$('trashItems').textContent='ごみ箱は空です。';trashNext=result.next;$('moreTrash').hidden=trashNext===null;
 }catch(error){$('notice').textContent=error.message;}finally{trashLoading=false;}
}
$('refreshTrash').onclick=()=>loadTrash();$('moreTrash').onclick=()=>loadTrash(true);$('trashDetails').ontoggle=()=>{if($('trashDetails').open)loadTrash();};
