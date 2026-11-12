import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const $=id=>document.getElementById(id);
const schema='witches_desk';
const cfgKey='witches-desk-config-v1';
const defaultConfig={url:'https://pqifpislzljilqatmtly.supabase.co',key:'sb_publishable_16wAhIyuMsClbOYoAZt6aQ_unXWTJ_n'};
const draftKey=id=>'witches-desk-draft-'+id;

let client,user,book,chapter,scene;
let books=[],chapters=[],scenes=[],characters=[],notes=[],worldEntries=[];
let timer,loading=false,dirty=false;

function show(id){
  for(const x of ['setup','auth','workspace']) $(x).hidden=x!==id;
  $('searchOpen').hidden=id!=='workspace';
}
function status(s){$('status').textContent=s}
function toast(s){
  $('toast').textContent=s;
  $('toast').classList.add('show');
  setTimeout(()=>$('toast').classList.remove('show'),3500);
}
function safeText(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function db(table){return client.schema(schema).from(table)}
async function query(p){const {data,error}=await p;if(error)throw error;return data}
function handleError(e){console.error(e);status('Error');toast(e?.message||String(e))}
function normalizeDoc(doc){return typeof doc==='string'?doc:(doc?.html||'')}
function plain(html){
  const d=document.createElement('div');d.innerHTML=html||'';return d.innerText.replace(/\n{3,}/g,'\n\n').trim();
}
function countWords(text){const t=String(text||'').trim();return t?t.split(/\s+/).length:0}
function download(name,content,type='text/plain;charset=utf-8'){
  const blob=new Blob([content],{type});const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function fileSafe(name){return (name||'manuscript').replace(/[^a-z0-9-_ ]/gi,'').trim()||'manuscript'}

function init(){
  const c=JSON.parse(localStorage.getItem(cfgKey)||'null')||defaultConfig;
  if(!c){show('setup');return}
  client=createClient(c.url,c.key,{auth:{persistSession:true,autoRefreshToken:true}});
  client.auth.onAuthStateChange((_event,s)=>{
    user=s?.user||null;
    if(!user){show('auth');$('signout').hidden=true}
    else{$('signout').hidden=false;show('workspace');loadBooks().catch(handleError)}
  });
  client.auth.getSession().then(({data})=>{if(!data.session)show('auth')}).catch(handleError);
}

$('configForm').onsubmit=e=>{
  e.preventDefault();
  const url=$('url').value.trim(),key=$('key').value.trim();
  if(!url.startsWith('https://')||!key)return;
  localStorage.setItem(cfgKey,JSON.stringify({url,key}));init();
};
$('authForm').onsubmit=async e=>{
  e.preventDefault();
  try{await authResult(client.auth.signInWithPassword({email:$('email').value,password:$('password').value}))}
  catch(err){$('authMessage').textContent=err.message}
};
$('signup').onclick=async()=>{
  try{
    await authResult(client.auth.signUp({
      email:$('email').value,password:$('password').value,
      options:{emailRedirectTo:window.location.origin+window.location.pathname}
    }));
    $('authMessage').textContent='Account created. Check your email for confirmation if required.';
  }catch(err){$('authMessage').textContent=err.message}
};
async function authResult(p){const {error}=await p;if(error)throw error}
$('signout').onclick=()=>client.auth.signOut().catch(handleError);

async function loadBooks(){
  books=await query(db('books').select('*').order('created_at'));
  $('books').replaceChildren();
  for(const b of books)$('books').add(new Option(b.title,b.id));
  book=books.find(b=>b.id===book?.id)||books[0]||null;
  if(book){$('books').value=book.id;await loadBook()}
  else{
    chapter=null;scene=null;clearEditor();
    $('chapters').replaceChildren();$('scenes').replaceChildren();$('characters').replaceChildren();$('notes').replaceChildren();
    updateBookStats();
  }
}
$('books').onchange=async()=>{await saveNow();book=books.find(b=>b.id===$('books').value);chapter=null;scene=null;await loadBook().catch(handleError)};
$('addBook').onclick=async()=>{
  const title=prompt('Manuscript title?');if(!title?.trim())return;
  try{book=await query(db('books').insert({title:title.trim()}).select().single());chapter=null;scene=null;await loadBooks()}catch(e){handleError(e)}
};
$('renameBook').onclick=async()=>{
  if(!book)return;const title=prompt('Rename manuscript:',book.title);if(!title?.trim()||title.trim()===book.title)return;
  try{await query(db('books').update({title:title.trim(),updated_at:new Date().toISOString()}).eq('id',book.id));book.title=title.trim();await loadBooks();toast('Manuscript renamed')}catch(e){handleError(e)}
};
$('deleteBook').onclick=async()=>{
  if(!book||!confirm('Delete this entire manuscript and all of its chapters, scenes, notes, revisions, and worldbuilding? This cannot be undone.'))return;
  try{await query(db('books').delete().eq('id',book.id));book=null;chapter=null;scene=null;await loadBooks();toast('Manuscript deleted')}catch(e){handleError(e)}
};

async function loadBook(){
  if(!book)return;
  $('povMode').value=book.pov_mode||'single';
  [chapters,characters,notes,worldEntries]=await Promise.all([
    query(db('chapters').select('*').eq('book_id',book.id).order('sort_order')),
    query(db('characters').select('*').eq('book_id',book.id).order('created_at')),
    query(db('notes').select('*').eq('book_id',book.id).order('updated_at',{ascending:false})),
    query(db('world_entries').select('*').eq('book_id',book.id).order('category').order('title'))
  ]);
  renderCharacters();renderNotes();renderChapters();
  chapter=chapters.find(c=>c.id===chapter?.id)||chapters[0]||null;
  await loadScenes();
}

function renderChapters(){
  $('chapters').replaceChildren();
  chapters.forEach(c=>{
    const b=document.createElement('button');b.textContent=c.title;b.className=c.id===chapter?.id?'selected':'';
    b.onclick=async()=>{await saveNow();chapter=c;scene=null;renderChapters();await loadScenes().catch(handleError)};
    $('chapters').append(b);
  });
}
$('addChapter').onclick=async()=>{
  if(!book)return toast('Create a manuscript first');
  const title=prompt('Chapter title?');if(!title?.trim())return;
  try{
    chapter=await query(db('chapters').insert({book_id:book.id,title:title.trim(),sort_order:chapters.length}).select().single());
    scene=null;await loadBook();
  }catch(e){handleError(e)}
};
$('renameChapter').onclick=async()=>{
  if(!chapter)return;
  const title=prompt('Rename chapter:',chapter.title);if(!title?.trim()||title.trim()===chapter.title)return;
  try{await query(db('chapters').update({title:title.trim(),updated_at:new Date().toISOString()}).eq('id',chapter.id));chapter.title=title.trim();renderChapters();toast('Chapter renamed')}catch(e){handleError(e)}
};
$('deleteChapter').onclick=async()=>{
  if(!chapter||!confirm('Delete this chapter and every scene inside it?'))return;
  try{await query(db('chapters').delete().eq('id',chapter.id));chapter=null;scene=null;await loadBook();toast('Chapter deleted')}catch(e){handleError(e)}
};
async function moveChapter(delta){
  if(!chapter)return;const i=chapters.findIndex(c=>c.id===chapter.id),j=i+delta;if(j<0||j>=chapters.length)return;
  const other=chapters[j];
  try{
    await Promise.all([
      query(db('chapters').update({sort_order:other.sort_order}).eq('id',chapter.id)),
      query(db('chapters').update({sort_order:chapter.sort_order}).eq('id',other.id))
    ]);
    [chapters[i],chapters[j]]=[chapters[j],chapters[i]];const t=chapter.sort_order;chapter.sort_order=other.sort_order;other.sort_order=t;renderChapters();toast('Chapter moved');
  }catch(e){handleError(e)}
}
$('chapterUp').onclick=()=>moveChapter(-1);$('chapterDown').onclick=()=>moveChapter(1);

async function loadScenes(){
  scenes=chapter?await query(db('scenes').select('*').eq('chapter_id',chapter.id).order('sort_order')):[];
  scene=scenes.find(s=>s.id===scene?.id)||scenes[0]||null;
  renderChapters();renderScenes();openScene();updateBookStats();
}
function renderScenes(){
  $('scenes').replaceChildren();
  scenes.forEach(s=>{
    const b=document.createElement('button');b.textContent=s.title;b.className=s.id===scene?.id?'selected':'';
    b.onclick=async()=>{await saveNow();scene=s;renderScenes();openScene()};
    $('scenes').append(b);
  });
}
$('addScene').onclick=async()=>{
  if(!chapter)return toast('Create a chapter first');
  try{scene=await query(db('scenes').insert({book_id:book.id,chapter_id:chapter.id,sort_order:scenes.length}).select().single());await loadScenes()}catch(e){handleError(e)}
};
$('deleteScene').onclick=async()=>{
  if(!scene||!confirm('Delete this scene?'))return;
  try{localStorage.removeItem(draftKey(scene.id));await query(db('scenes').delete().eq('id',scene.id));scene=null;await loadScenes();toast('Scene deleted')}catch(e){handleError(e)}
};
async function moveScene(delta){
  if(!scene)return;const i=scenes.findIndex(s=>s.id===scene.id),j=i+delta;if(j<0||j>=scenes.length)return;
  const other=scenes[j];
  try{
    await Promise.all([
      query(db('scenes').update({sort_order:other.sort_order}).eq('id',scene.id)),
      query(db('scenes').update({sort_order:scene.sort_order}).eq('id',other.id))
    ]);
    [scenes[i],scenes[j]]=[scenes[j],scenes[i]];const t=scene.sort_order;scene.sort_order=other.sort_order;other.sort_order=t;renderScenes();toast('Scene moved');
  }catch(e){handleError(e)}
}
$('sceneUp').onclick=()=>moveScene(-1);$('sceneDown').onclick=()=>moveScene(1);

function clearEditor(){
  $('editor').innerHTML='';$('sceneTitle').value='';$('wordCount').textContent='0 words';$('editor').contentEditable='false';
}
function openScene(){
  loading=true;
  if(!scene){clearEditor();loading=false;return}
  $('editor').contentEditable='true';$('sceneTitle').value=scene.title;
  const draft=localStorage.getItem(draftKey(scene.id));let doc=scene.content;
  try{
    if(draft){const d=JSON.parse(draft);if(d.updated>new Date(scene.updated_at).getTime()){doc={html:d.html};toast('Recovered a newer local draft')}}
  }catch{}
  $('editor').innerHTML=normalizeDoc(doc);
  $('pov').replaceChildren(new Option('Unassigned',''));characters.forEach(c=>$('pov').add(new Option(c.name,c.id)));
  $('pov').value=scene.pov_character_id||'';count();dirty=false;loading=false;status('Saved');
}
function count(){
  const wc=countWords($('editor').innerText);
  $('wordCount').textContent=wc+' words';
}
function changed(){
  if(loading||!scene)return;
  dirty=true;count();status('Unsaved changes');
  localStorage.setItem(draftKey(scene.id),JSON.stringify({html:$('editor').innerHTML,updated:Date.now()}));
  clearTimeout(timer);timer=setTimeout(()=>saveNow().catch(handleError),850);
}
$('editor').addEventListener('input',changed);$('sceneTitle').addEventListener('input',changed);$('pov').onchange=changed;

async function saveNow(){
  clearTimeout(timer);if(!dirty||!scene)return;
  const current=scene,html=$('editor').innerHTML,title=$('sceneTitle').value.trim()||'Untitled Scene',pov=$('pov').value||null,wc=countWords($('editor').innerText);
  status('Saving…');
  try{
    const saved=await query(db('scenes').update({
      title,content:{html},pov_character_id:pov,word_count:wc,updated_at:new Date().toISOString()
    }).eq('id',current.id).select().single());
    Object.assign(current,saved);dirty=false;localStorage.removeItem(draftKey(current.id));renderScenes();status('Saved');updateBookStats();
  }catch(e){dirty=true;status('Offline / unsaved');throw e}
}
$('povMode').onchange=async()=>{
  if(!book)return;
  try{await query(db('books').update({pov_mode:$('povMode').value,updated_at:new Date().toISOString()}).eq('id',book.id));book.pov_mode=$('povMode').value;toast('POV structure saved')}catch(e){handleError(e)}
};

function renderCharacters(){
  $('characters').replaceChildren();
  characters.forEach(c=>{
    const b=document.createElement('button');b.className='entry';b.textContent=c.name;
    b.onclick=()=>openGrimoireTo('characters',c.id);$('characters').append(b);
  });
}
$('addCharacter').onclick=()=>{if(!book)return;grimoireCategory='characters';grimoireSelected=null;grimoireOpen();$('entryName').focus()};

function renderNotes(){
  $('notes').replaceChildren();
  notes.filter(n=>n.category!=='grimoire').forEach(n=>{
    const b=document.createElement('button');b.className='entry';b.textContent=n.title;
    b.onclick=async()=>{
      const title=prompt('Note title:',n.title);if(title===null)return;
      const body=prompt('Edit note:',n.body||'');if(body===null)return;
      try{await query(db('notes').update({title:title.trim()||'Untitled Note',body,updated_at:new Date().toISOString()}).eq('id',n.id));await loadBook()}catch(e){handleError(e)}
    };
    $('notes').append(b);
  });
}
$('addNote').onclick=async()=>{
  if(!book)return;const title=prompt('Note title?');if(!title?.trim())return;const body=prompt('Note text:')||'';
  try{await query(db('notes').insert({book_id:book.id,title:title.trim(),body,category:'general'}));await loadBook()}catch(e){handleError(e)}
};

document.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>{
  if(!scene)return;$('editor').focus();document.execCommand(b.dataset.cmd,false,null);changed();
});
document.querySelectorAll('[data-block]').forEach(b=>b.onclick=()=>{
  if(!scene)return;$('editor').focus();document.execCommand('formatBlock',false,b.dataset.block);changed();
});

$('snapshot').onclick=async()=>{
  if(!scene)return;
  try{await saveNow();await query(db('scene_revisions').insert({book_id:book.id,scene_id:scene.id,content:scene.content}));toast('Revision checkpoint saved')}catch(e){handleError(e)}
};

$('revisions').onclick=async()=>{
  if(!scene)return;
  try{
    const rows=await query(db('scene_revisions').select('*').eq('scene_id',scene.id).order('created_at',{ascending:false}));
    const root=$('revisionList');root.replaceChildren();
    if(!rows.length){root.innerHTML='<p class="hint">No saved revisions for this scene yet.</p>'}
    rows.forEach((r,i)=>{
      const wrap=document.createElement('div');wrap.className='revisionCard';
      const preview=plain(normalizeDoc(r.content)).slice(0,180);
      wrap.innerHTML='<div><strong>Revision '+(rows.length-i)+'</strong><small>'+new Date(r.created_at).toLocaleString()+'</small><p>'+safeText(preview||'(empty scene)')+'</p></div>';
      const btn=document.createElement('button');btn.textContent='Restore';btn.onclick=async()=>{
        if(!confirm('Restore this revision? The current scene will be saved as a new revision first.'))return;
        try{
          await saveNow();await query(db('scene_revisions').insert({book_id:book.id,scene_id:scene.id,content:scene.content}));
          const restored=await query(db('scenes').update({content:r.content,word_count:countWords(plain(normalizeDoc(r.content))),updated_at:new Date().toISOString()}).eq('id',scene.id).select().single());
          Object.assign(scene,restored);openScene();$('revisionDialog').close();toast('Revision restored');
        }catch(e){handleError(e)}
      };
      wrap.append(btn);root.append(wrap);
    });
    $('revisionDialog').showModal();
  }catch(e){handleError(e)}
};

$('findReplace').onclick=()=>{if(scene)$('findDialog').showModal()};
$('findForm').onsubmit=e=>{
  e.preventDefault();if(!scene)return;
  const find=$('findText').value,rep=$('replaceText').value;if(!find)return;
  const walker=document.createTreeWalker($('editor'),NodeFilter.SHOW_TEXT);let n,total=0;
  const nodes=[];while(n=walker.nextNode())nodes.push(n);
  for(const node of nodes){const parts=node.nodeValue.split(find);if(parts.length>1){total+=parts.length-1;node.nodeValue=parts.join(rep)}}
  if(total){changed();toast(total+' replacement'+(total===1?'':'s')+' made')}else toast('No matches in this scene');
  $('findDialog').close();
};

async function allBookScenes(){
  if(!book)return[];
  const cs=await query(db('chapters').select('*').eq('book_id',book.id).order('sort_order'));
  const ss=await query(db('scenes').select('*').eq('book_id',book.id).order('sort_order'));
  return cs.map(c=>({...c,scenes:ss.filter(s=>s.chapter_id===c.id).sort((a,b)=>a.sort_order-b.sort_order)}));
}
async function updateBookStats(){
  if(!book){$('bookWordCount').textContent='0 manuscript words';$('sceneCount').textContent='0 scenes';return}
  try{
    const rows=await query(db('scenes').select('word_count').eq('book_id',book.id));
    $('bookWordCount').textContent=rows.reduce((a,s)=>a+(s.word_count||0),0).toLocaleString()+' manuscript words';
    $('sceneCount').textContent=rows.length+' scene'+(rows.length===1?'':'s');
  }catch{}
}

$('searchOpen').onclick=async()=>{
  if(!book)return;await saveNow();
  $('searchQuery').value='';$('searchResults').innerHTML='<p class="hint">Type to search this manuscript.</p>';$('searchDialog').showModal();$('searchQuery').focus();
};
$('searchQuery').oninput=()=>{
  const q=$('searchQuery').value.trim().toLowerCase(),root=$('searchResults');root.replaceChildren();if(q.length<2){root.innerHTML='<p class="hint">Type at least two characters.</p>';return}
  const results=[];
  chapters.forEach(c=>{if(c.title.toLowerCase().includes(q))results.push({type:'Chapter',title:c.title,action:()=>{chapter=c;scene=null;loadScenes();$('searchDialog').close()}})});
  characters.forEach(c=>{if((c.name+' '+(c.description||'')).toLowerCase().includes(q))results.push({type:'Character',title:c.name,sub:c.description,action:()=>{openGrimoireTo('characters',c.id);$('searchDialog').close()}})});
  notes.forEach(n=>{if((n.title+' '+(n.body||'')).toLowerCase().includes(q))results.push({type:'Note',title:n.title,sub:n.body})});
  worldEntries.forEach(w=>{if((w.title+' '+w.summary+' '+w.details).toLowerCase().includes(q))results.push({type:w.category,title:w.title,sub:w.summary,action:()=>{openGrimoireTo(w.category,w.id);$('searchDialog').close()}})});
  (async()=>{
    const all=await query(db('scenes').select('*').eq('book_id',book.id).order('sort_order'));
    all.forEach(s=>{const text=plain(normalizeDoc(s.content));if((s.title+' '+text).toLowerCase().includes(q))results.push({type:'Scene',title:s.title,sub:text,action:async()=>{const c=chapters.find(x=>x.id===s.chapter_id);if(c){await saveNow();chapter=c;scene=s;await loadScenes()}$('searchDialog').close()}})});
    renderSearch(results,root);
  })().catch(handleError);
};
function renderSearch(results,root){
  root.replaceChildren();
  if(!results.length){root.innerHTML='<p class="hint">No matches found.</p>';return}
  results.slice(0,80).forEach(r=>{
    const b=document.createElement('button');b.className='searchResult';
    b.innerHTML='<small>'+safeText(r.type)+'</small><strong>'+safeText(r.title)+'</strong><span>'+safeText((r.sub||'').slice(0,140))+'</span>';
    if(r.action)b.onclick=r.action;root.append(b);
  });
}

const grimoireCategories=['characters','settings','items','plotlines','lore'];
let grimoireCategory='characters',grimoireSelected=null;

function grimoireRecords(){
  if(grimoireCategory==='characters')return characters.map(c=>({id:c.id,name:c.name,summary:c.description||'',details:'',kind:'character'}));
  return worldEntries.filter(w=>w.category===grimoireCategory).map(w=>({id:w.id,name:w.title,summary:w.summary||'',details:w.details||'',kind:'world'}));
}
function grimoireRender(){
  document.querySelectorAll('[data-category]').forEach(b=>{const a=b.dataset.category===grimoireCategory;b.classList.toggle('active',a);b.setAttribute('aria-selected',String(a))});
  const filter=$('grimoireFilter').value.trim().toLowerCase(),root=$('grimoireEntries');root.replaceChildren();
  for(const record of grimoireRecords().filter(r=>!filter||(r.name+' '+r.summary+' '+r.details).toLowerCase().includes(filter))){
    const b=document.createElement('button');b.type='button';b.textContent=record.name;b.className=record.id===grimoireSelected?'selected':'';
    b.onclick=()=>{grimoireSelected=record.id;grimoireFill(record);grimoireRender()};root.append(b);
  }
}
function grimoireFill(r){
  $('entryName').value=r?.name||'';$('entrySummary').value=r?.summary||'';$('entryDetails').value=r?.details||'';$('deleteEntry').disabled=!r;$('grimoireNotice').textContent='';
}
function grimoireOpen(){
  if(!book)return toast('Create a manuscript first');
  $('grimoireFilter').value='';grimoireFill(null);grimoireRender();$('grimoireDialog').showModal();
}
function openGrimoireTo(category,id){
  grimoireCategory=category;grimoireSelected=id;$('grimoireFilter').value='';
  const r=grimoireRecords().find(x=>x.id===id)||null;grimoireFill(r);grimoireRender();$('grimoireDialog').showModal();
}
$('openGrimoire').onclick=()=>{grimoireCategory='characters';grimoireSelected=null;grimoireOpen()};
$('closeGrimoire').onclick=()=>$('grimoireDialog').close();
$('grimoireFilter').oninput=grimoireRender;
document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{
  grimoireCategory=b.dataset.category;grimoireSelected=null;grimoireFill(null);grimoireRender();
});
$('newEntry').onclick=()=>{grimoireSelected=null;grimoireFill(null);grimoireRender();$('entryName').focus()};
$('grimoireForm').onsubmit=async e=>{
  e.preventDefault();if(!book)return;
  const name=$('entryName').value.trim(),summary=$('entrySummary').value.trim(),details=$('entryDetails').value.trim();if(!name)return;
  try{
    if(grimoireCategory==='characters'){
      const record={name,description:[summary,details].filter(Boolean).join('\n\n')};
      if(grimoireSelected)await query(db('characters').update(record).eq('id',grimoireSelected).eq('book_id',book.id));
      else await query(db('characters').insert({...record,book_id:book.id}));
    }else{
      const record={category:grimoireCategory,title:name,summary,details,updated_at:new Date().toISOString()};
      if(grimoireSelected)await query(db('world_entries').update(record).eq('id',grimoireSelected).eq('book_id',book.id));
      else await query(db('world_entries').insert({...record,book_id:book.id}));
    }
    await loadBook();grimoireSelected=null;grimoireFill(null);grimoireRender();$('grimoireNotice').textContent='Entry saved to your private story archive';toast('Grimoire entry saved');
  }catch(e){handleError(e);$('grimoireNotice').textContent=e.message||'Could not save'}
};
$('deleteEntry').onclick=async()=>{
  if(!book||!grimoireSelected||!confirm('Delete this story entry?'))return;
  try{
    const table=grimoireCategory==='characters'?'characters':'world_entries';
    await query(db(table).delete().eq('id',grimoireSelected).eq('book_id',book.id));
    await loadBook();grimoireSelected=null;grimoireFill(null);grimoireRender();toast('Entry deleted');
  }catch(e){handleError(e)}
};

$('exportMenu').onclick=()=>{if(book)$('exportDialog').showModal()};
document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportData(b.dataset.export).catch(handleError));
async function exportData(kind){
  await saveNow();if(!book)return;
  if(kind==='scene-html'&&scene){
    download(fileSafe(scene.title)+'.html','<!doctype html><meta charset="utf-8"><title>'+safeText(scene.title)+'</title><article>'+$('editor').innerHTML+'</article>','text/html;charset=utf-8');
  }
  if(kind==='scene-txt'&&scene)download(fileSafe(scene.title)+'.txt',$('editor').innerText);
  if(kind==='book-html'||kind==='book-txt'||kind==='backup-json'){
    const structure=await allBookScenes();
    if(kind==='book-html'){
      let body='<h1>'+safeText(book.title)+'</h1>';
      for(const c of structure){body+='<h2>'+safeText(c.title)+'</h2>';for(const s of c.scenes)body+='<section><h3>'+safeText(s.title)+'</h3>'+normalizeDoc(s.content)+'</section>'}
      download(fileSafe(book.title)+'.html','<!doctype html><meta charset="utf-8"><title>'+safeText(book.title)+'</title><style>body{max-width:760px;margin:40px auto;font:18px/1.7 Georgia,serif;padding:20px}h1,h2,h3{page-break-after:avoid}section{page-break-inside:auto}</style>'+body,'text/html;charset=utf-8');
    }
    if(kind==='book-txt'){
      let out=book.title+'\n'+('=' .repeat(book.title.length))+'\n\n';
      for(const c of structure){out+=c.title+'\n\n';for(const s of c.scenes)out+=s.title+'\n\n'+plain(normalizeDoc(s.content))+'\n\n'}
      download(fileSafe(book.title)+'.txt',out);
    }
    if(kind==='backup-json'){
      const revisions=await query(db('scene_revisions').select('*').eq('book_id',book.id).order('created_at'));
      const backup={format:'witches-desk-backup-v1',exported_at:new Date().toISOString(),book,chapters:structure.map(({scenes,...c})=>c),scenes:structure.flatMap(c=>c.scenes),characters,notes,world_entries:worldEntries,revisions};
      download(fileSafe(book.title)+'-backup.json',JSON.stringify(backup,null,2),'application/json;charset=utf-8');
    }
  }
  $('exportDialog').close();
}
$('printManuscript').onclick=async()=>{
  await saveNow();const structure=await allBookScenes();let body='<h1>'+safeText(book.title)+'</h1>';
  for(const c of structure){body+='<h2>'+safeText(c.title)+'</h2>';for(const s of c.scenes)body+='<section><h3>'+safeText(s.title)+'</h3>'+normalizeDoc(s.content)+'</section>'}
  const w=window.open('','_blank');w.document.write('<!doctype html><title>'+safeText(book.title)+'</title><style>@page{margin:1in}body{font:12pt/1.65 Georgia,serif;color:#111}h1{text-align:center;margin:30vh 0 1in}h2{page-break-before:always}h3{margin-top:2em}p{orphans:3;widows:3}</style>'+body);w.document.close();w.focus();setTimeout(()=>w.print(),250);$('exportDialog').close();
};

document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
window.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveNow().then(()=>toast('Saved')).catch(handleError)}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'&&scene){e.preventDefault();$('findDialog').showModal();$('findText').focus()}
});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});

init();
