'use strict';
const $=id=>document.getElementById(id), DB='myfiles-music-v1';let db,folder=null,tracks=[],current=null,url=null,shuffle=false,repeat=false,queue=[];
const supported=/\.(mp3|m4a|wav|aac|flac|ogg|opus)$/i;
const tx=(store,mode='readonly')=>db.transaction(store,mode).objectStore(store);
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
function openDB(){return new Promise((resolve,reject)=>{let r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{let d=r.result;d.createObjectStore('folders',{keyPath:'id'});d.createObjectStore('files',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
const uid=()=>crypto.randomUUID();const fmt=s=>!Number.isFinite(s)?'0:00':`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const size=n=>n<1048576?`${(n/1024).toFixed(0)} KB`:`${(n/1048576).toFixed(1)} MB`;
function status(s){$('status').textContent=s}function node(tag,text,cls){let e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e}
async function all(store){return request(tx(store).getAll())}
async function put(store,item){return new Promise((resolve,reject)=>{const transaction=db.transaction(store,'readwrite');transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error||new Error('データベース書き込みエラー'));transaction.onabort=()=>reject(transaction.error||new Error('保存が中断されました'));transaction.objectStore(store).put(item)})}
async function del(store,id){return request(tx(store,'readwrite').delete(id))}
async function refresh(){let fs=await all('folders'),files=await all('files');tracks=files;let name=folder===null?'マイファイル':fs.find(f=>f.id===folder)?.name||'フォルダ';$('path').textContent='📂 '+name;$('back').disabled=folder===null;let root=$('list');root.replaceChildren();let visibleFolders=fs.filter(f=>f.parent===folder).sort((a,b)=>a.name.localeCompare(b.name,'ja'));let visibleFiles=files.filter(f=>f.parent===folder).sort((a,b)=>a.name.localeCompare(b.name,'ja'));for(let f of visibleFolders){let item=node('div',undefined,'item');item.append(node('span','📁','icon'));let name=node('div',undefined,'name');let open=node('button',f.name);open.onclick=()=>{folder=f.id;refresh()};name.append(open);item.append(name);let actions=node('div',undefined,'actions');let menu=node('button','⋯');menu.onclick=()=>menuFolder(f);actions.append(menu);item.append(actions);root.append(item)}for(let f of visibleFiles){let item=node('div',undefined,'item');item.append(node('span','🎵','icon'));let name=node('div',undefined,'name');let open=node('button',f.name);open.onclick=()=>start(f.id);name.append(open,node('div',size(f.size),'sub'));item.append(name);let actions=node('div',undefined,'actions');let menu=node('button','⋯');menu.onclick=()=>menuFile(f);actions.append(menu);item.append(actions);root.append(item)}if(!visibleFolders.length&&!visibleFiles.length)root.append(node('div','ここにはまだファイルがありません','empty'));$('usage').textContent=`保存曲数: ${files.length} 曲 / 合計: ${(files.reduce((s,f)=>s+f.size,0)/1073741824).toFixed(2)} GB`}
function dialog(title,buttons){let d=$('dlg'),content=$('dialogcontent');content.replaceChildren(node('h3',title));for(let b of buttons){let btn=node('button',b.label);btn.onclick=async()=>{d.close();try{await b.action()}catch(e){status('操作できませんでした: '+e.message)}};content.append(btn)}d.showModal()}
$('cancel').onclick=()=>$('dlg').close();
async function askName(message,initial=''){let name=prompt(message,initial);return name&&name.trim()?name.trim():null}
$('newfolder').onclick=async()=>{let name=await askName('フォルダ名');if(name){await put('folders',{id:uid(),name,parent:folder});refresh()}};
$('back').onclick=async()=>{let f=folder===null?null:await request(tx('folders').get(folder));folder=f?.parent??null;refresh()};
$('pick').onchange=async e=>{
  const selected=[...e.target.files];e.target.value='';if(!selected.length)return;
  let count=0;let failed=null;
  for(const file of selected){
    if(!file.type.startsWith('audio/')&&!supported.test(file.name)){failed=`${file.name}: 音声ファイルとして認識できません`;break}
    try{
      status(`保存中 ${count+1}/${selected.length}: ${file.name}`);
      // iOS SafariではFileを直接保存するよりBlobに変換した方が安定する場合がある
      const blob=new Blob([await file.arrayBuffer()],{type:file.type||'audio/mpeg'});
      await put('files',{id:uid(),name:file.name,parent:folder,size:file.size,blob,created:Date.now()});
      count++;
    }catch(err){
      const estimate=await navigator.storage?.estimate?.().catch(()=>null);
      const extra=estimate?`（使用量 ${size(estimate.usage||0)} / 推定上限 ${size(estimate.quota||0)}）`:'';
      failed=`${file.name}: ${err.name||'Error'} ${err.message||'保存できませんでした'} ${extra}`;
      break;
    }
  }
  try{await refresh()}catch(err){failed=failed||`一覧更新エラー: ${err.message}`}
  status(failed?`取り込み失敗：${failed}。成功 ${count}/${selected.length} 曲。元ファイルは削除しないでください。`:`${count} 曲取り込みました。元ファイルは削除しないでください。`);
};
async function chooseFolder(item,store){let folders=await all('folders');let descendants=new Set([item.id]);if(store==='folders'){let changed=true;while(changed){changed=false;for(let f of folders)if(descendants.has(f.parent)&&!descendants.has(f.id)){descendants.add(f.id);changed=true}}}let options=[{id:null,name:'マイファイル'},...folders].filter(f=>store!=='folders'||!descendants.has(f.id));dialog('移動先を選択',options.map(f=>({label:f.name,action:async()=>{item.parent=f.id;await put(store,item);refresh()}})))}
function menuFile(f){dialog(f.name,[{label:'名前変更',action:async()=>{let name=await askName('新しいファイル名',f.name);if(name){f.name=name;await put('files',f);refresh()}}},{label:'移動',action:()=>chooseFolder(f,'files')},{label:'ファイルに書き出す',action:async()=>{let a=document.createElement('a');let u=URL.createObjectURL(f.blob);a.href=u;a.download=f.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000)}},{label:'削除',action:async()=>{if(confirm(`「${f.name}」を削除しますか？`)){if(current===f.id)stop();await del('files',f.id);refresh()}}}])}
function menuFolder(f){dialog(f.name,[{label:'名前変更',action:async()=>{let name=await askName('新しいフォルダ名',f.name);if(name){f.name=name;await put('folders',f);refresh()}}},{label:'移動',action:()=>chooseFolder(f,'folders')},{label:'削除',action:async()=>{let fs=await all('folders'),files=await all('files');if(fs.some(x=>x.parent===f.id)||files.some(x=>x.parent===f.id)){alert('空のフォルダのみ削除できます');return}if(confirm(`「${f.name}」を削除しますか？`)){await del('folders',f.id);refresh()}}}])}
function stop(){ $('audio').pause();$('audio').removeAttribute('src');$('audio').load();if(url)URL.revokeObjectURL(url);url=null;current=null;$('now').textContent='曲を選んでください';$('play').textContent='▶'}
async function start(id){let f=tracks.find(t=>t.id===id);if(!f)return;try{if(url)URL.revokeObjectURL(url);$('audio').pause();url=URL.createObjectURL(f.blob);current=id;$('audio').src=url;$('now').textContent=f.name;queue=tracks.filter(x=>x.parent===f.parent).map(x=>x.id);await $('audio').play();if('mediaSession' in navigator){navigator.mediaSession.metadata=new MediaMetadata({title:f.name,artist:'MyFiles Music'});navigator.mediaSession.setActionHandler('nexttrack',()=>advance(1));navigator.mediaSession.setActionHandler('previoustrack',()=>advance(-1));navigator.mediaSession.setActionHandler('play',()=>$('audio').play());navigator.mediaSession.setActionHandler('pause',()=>$('audio').pause())}}catch(e){status('再生できません: '+e.message)}}
function advance(n){if(!queue.length)return;if(shuffle&&n>0){let ids=queue.filter(x=>x!==current);start(ids[Math.floor(Math.random()*ids.length)]||current);return}let i=queue.indexOf(current),next=i+n;if(next>=queue.length){if(!repeat){stop();return}next=0}if(next<0)next=queue.length-1;start(queue[next])}
$('play').onclick=()=>{if(!current){if(tracks.length)start(tracks[0].id);return}let a=$('audio');a.paused?a.play().catch(e=>status(e.message)):a.pause()};$('prev').onclick=()=>advance(-1);$('next').onclick=()=>advance(1);$('shuffle').onclick=()=>{shuffle=!shuffle;$('shuffle').style.background=shuffle?'#5969d4':''};$('repeat').onclick=()=>{repeat=!repeat;$('repeat').style.background=repeat?'#5969d4':''};$('audio').onplay=()=>$('play').textContent='⏸';$('audio').onpause=()=>$('play').textContent='▶';$('audio').onended=()=>advance(1);$('audio').ontimeupdate=()=>{let a=$('audio');$('seek').value=a.duration?Math.floor(a.currentTime/a.duration*1000):0;$('time').textContent=`${fmt(a.currentTime)} / ${fmt(a.duration)}`};$('seek').oninput=e=>{let a=$('audio');if(Number.isFinite(a.duration))a.currentTime=a.duration*e.target.value/1000};
(async()=>{try{db=await openDB();await refresh();if(navigator.storage?.persist){let ok=await navigator.storage.persist();status(ok?'保存領域の永続化が許可されています':'元ファイルは必ず別途保管してください')}}catch(e){status('初期化失敗: '+e.message)}if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(e=>status('オフライン設定失敗: '+e.message))})();
