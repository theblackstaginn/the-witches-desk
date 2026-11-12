import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';

// Distinguish the installed iPhone Home Screen app from Safari.
const installedWebApp = Boolean(window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);
document.documentElement.classList.toggle('installedWebApp', installedWebApp);

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

  if(!chapters.length){
    chapter=await query(db('chapters').insert({
      book_id:book.id,
      title:'Chapter 1',
      sort_order:0
    }).select().single());

    scene=await query(db('scenes').insert({
      book_id:book.id,
      chapter_id:chapter.id,
      title:'Untitled Scene',
      sort_order:0
    }).select().single());

    chapters=[chapter];
    scenes=[scene];
    toast('Your first chapter and scene are ready');
  }

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
  if($('mobileSceneLabel'))$('mobileSceneLabel').textContent='Choose a scene';
}
function openScene(){
  loading=true;
  if(!scene){clearEditor();loading=false;return}
  $('editor').contentEditable='true';$('sceneTitle').value=scene.title;
  if($('mobileSceneLabel'))$('mobileSceneLabel').textContent=scene.title||'Untitled Scene';
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
$('addCharacter').onclick=()=>{if(!book)return;grimoireCategory='characters';grimoireSelected=null;grimoireOpen();setGrimoireMobileEditor(true);$('entryName').focus()};

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
function setGrimoireMobileEditor(editing){
  const dialog=$('grimoireDialog');
  const isMobile=installedWebApp && window.matchMedia('(max-width:760px)').matches;
  dialog.classList.toggle('mobileEditing',Boolean(editing&&isMobile));
  if(isMobile){
    const body=dialog.querySelector('.grimoireBody');
    if(body)body.scrollTop=0;
    if(editing)requestAnimationFrame(()=>{$('grimoireForm').scrollTop=0});
  }
}
$('backToGrimoireList').onclick=()=>{setGrimoireMobileEditor(false);$('grimoireFilter').focus({preventScroll:true})};
$('grimoireDialog').addEventListener('close',()=>setGrimoireMobileEditor(false));

function grimoireRecords(){
  if(grimoireCategory==='characters')return characters.map(c=>({id:c.id,name:c.name,summary:c.description||'',details:'',kind:'character'}));
  return worldEntries.filter(w=>w.category===grimoireCategory).map(w=>({id:w.id,name:w.title,summary:w.summary||'',details:w.details||'',kind:'world'}));
}
function grimoireRender(){
  document.querySelectorAll('[data-category]').forEach(b=>{const a=b.dataset.category===grimoireCategory;b.classList.toggle('active',a);b.setAttribute('aria-selected',String(a))});
  const filter=$('grimoireFilter').value.trim().toLowerCase(),root=$('grimoireEntries');root.replaceChildren();
  for(const record of grimoireRecords().filter(r=>!filter||(r.name+' '+r.summary+' '+r.details).toLowerCase().includes(filter))){
    const b=document.createElement('button');b.type='button';b.textContent=record.name;b.className=record.id===grimoireSelected?'selected':'';
    b.onclick=()=>{grimoireSelected=record.id;grimoireFill(record);grimoireRender();setGrimoireMobileEditor(true)};root.append(b);
  }
  if(!root.children.length){
    const note=document.createElement('p');
    note.className='hint grimoireEmpty';
    note.textContent=filter?'No matching entries.':'No entries here yet. Choose New entry to begin.';
    root.append(note);
  }
}
function grimoireFill(r){
  $('entryName').value=r?.name||'';$('entrySummary').value=r?.summary||'';$('entryDetails').value=r?.details||'';$('deleteEntry').disabled=!r;$('grimoireNotice').textContent='';
  $('grimoireEditLabel').textContent=r?'Edit '+(r.name||'entry'):'New entry';
}
function grimoireOpen(){
  if(!book)return toast('Create a manuscript first');
  $('grimoireFilter').value='';grimoireFill(null);grimoireRender();setGrimoireMobileEditor(false);$('grimoireDialog').showModal();
}
function openGrimoireTo(category,id){
  grimoireCategory=category;grimoireSelected=id;$('grimoireFilter').value='';
  const r=grimoireRecords().find(x=>x.id===id)||null;grimoireFill(r);grimoireRender();setGrimoireMobileEditor(Boolean(r));$('grimoireDialog').showModal();
}
$('openGrimoire').onclick=()=>{grimoireCategory='characters';grimoireSelected=null;grimoireOpen()};
$('closeGrimoire').onclick=()=>$('grimoireDialog').close();
$('grimoireFilter').oninput=grimoireRender;
document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{
  grimoireCategory=b.dataset.category;grimoireSelected=null;grimoireFill(null);grimoireRender();setGrimoireMobileEditor(false);
});
$('newEntry').onclick=()=>{grimoireSelected=null;grimoireFill(null);grimoireRender();setGrimoireMobileEditor(true);$('entryName').focus()};
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
    await loadBook();grimoireSelected=null;grimoireFill(null);grimoireRender();setGrimoireMobileEditor(false);$('grimoireNotice').textContent='Entry saved to your private story archive';toast('Grimoire entry saved');
  }catch(e){handleError(e);$('grimoireNotice').textContent=e.message||'Could not save'}
};
$('deleteEntry').onclick=async()=>{
  if(!book||!grimoireSelected||!confirm('Delete this story entry?'))return;
  try{
    const table=grimoireCategory==='characters'?'characters':'world_entries';
    await query(db(table).delete().eq('id',grimoireSelected).eq('book_id',book.id));
    await loadBook();grimoireSelected=null;grimoireFill(null);grimoireRender();setGrimoireMobileEditor(false);toast('Entry deleted');
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
  if(!book){toast('Create a manuscript first');return}
  // Open the print window immediately from the click, before asynchronous database reads.
  const w=window.open('','_blank');
  if(!w){toast('Allow pop-ups to print or save the manuscript as PDF');return}
  w.document.write('<!doctype html><title>Preparing manuscript…</title><p>Preparing your manuscript…</p>');
  try{
    await saveNow();
    const structure=await allBookScenes();
    let body='<h1>'+safeText(book.title)+'</h1>';
    for(const c of structure){body+='<h2>'+safeText(c.title)+'</h2>';for(const sceneRow of c.scenes)body+='<section><h3>'+safeText(sceneRow.title)+'</h3>'+normalizeDoc(sceneRow.content)+'</section>'}
    w.document.open();
    w.document.write('<!doctype html><title>'+safeText(book.title)+'</title><style>@page{margin:1in}body{font:12pt/1.65 Georgia,serif;color:#111}h1{text-align:center;margin:30vh 0 1in}h2{page-break-before:always}h3{margin-top:2em}p{orphans:3;widows:3}</style>'+body);
    w.document.close();w.focus();setTimeout(()=>w.print(),350);
    if($('exportDialog').open)$('exportDialog').close();
  }catch(e){w.close();handleError(e)}
};

document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
window.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveNow().then(()=>toast('Saved')).catch(handleError)}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'&&scene){e.preventDefault();$('findDialog').showModal();$('findText').focus()}
});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});


// Fully functional navigation and editor menus - 2026-11-12
let selectedDeskNote=null;
let lastEditorRange=null;
const deskMenu=$('deskMenu');
const menuTriggers=[...document.querySelectorAll('.menuTrigger')];

document.addEventListener('selectionchange',()=>{
  const selection=window.getSelection();
  if(selection&&selection.rangeCount&&$('editor').contains(selection.anchorNode)){
    lastEditorRange=selection.getRangeAt(0).cloneRange();
  }
});
function focusManuscript(){
  if(!scene)return false;
  $('editor').focus();
  if(lastEditorRange){
    try{
      if($('editor').contains(lastEditorRange.startContainer)&&$('editor').contains(lastEditorRange.endContainer)){
        const selection=window.getSelection();
        selection.removeAllRanges();selection.addRange(lastEditorRange);
      }
    }catch(e){lastEditorRange=null}
  }
  return true;
}
function editorCommand(command,value=null){
  if(!scene){toast('Create a scene first');return}
  focusManuscript();
  document.execCommand(command,false,value);
  changed();
}
function editorBlock(tag){
  if(!scene){toast('Create a scene first');return}
  focusManuscript();
  document.execCommand('formatBlock',false,tag);
  changed();
}
function activateModule(name){
  document.querySelectorAll('[data-module]').forEach(node=>{
    const active=node.dataset.module===name;
    node.classList.toggle('active',active);
    node.setAttribute('aria-current',active?'page':'false');
  });
}
function openStoryCategory(category){
  if(!book){toast('Create a manuscript first');return}
  grimoireCategory=category;grimoireSelected=null;grimoireOpen();
}
function openWorldOverview(){
  if(!book){toast('Create a manuscript first');return}
  const categories=[
    {key:'characters',title:'Characters',desc:'People, motivations, relationships, and secrets',count:characters.length,icon:'♟'},
    {key:'settings',title:'Locations',desc:'Settings, landmarks, regions, and worlds',count:worldEntries.filter(w=>w.category==='settings').length,icon:'⌾'},
    {key:'items',title:'Items & Artifacts',desc:'Objects, relics, tools, and treasures',count:worldEntries.filter(w=>w.category==='items').length,icon:'◇'},
    {key:'plotlines',title:'Plots & Timelines',desc:'Story arcs, events, and major threads',count:worldEntries.filter(w=>w.category==='plotlines').length,icon:'⌁'},
    {key:'lore',title:'Lore & Creatures',desc:'Histories, creatures, traditions, and magic',count:worldEntries.filter(w=>w.category==='lore').length,icon:'▤'}
  ];
  const root=$('worldOverviewGrid');root.replaceChildren();
  for(const category of categories){
    const btn=document.createElement('button');btn.type='button';btn.className='worldOverviewCard';
    const icon=document.createElement('span');icon.className='worldOverviewIcon';icon.textContent=category.icon;
    const info=document.createElement('div');
    const title=document.createElement('strong');title.textContent=category.title;
    const description=document.createElement('p');description.textContent=category.desc;
    info.append(title,description);
    const count=document.createElement('span');count.className='worldOverviewCount';count.textContent=category.count+' saved';
    btn.append(icon,info,count);
    btn.onclick=()=>{$('worldOverviewDialog').close();openStoryCategory(category.key)};
    root.append(btn);
  }
  $('worldOverviewDialog').showModal();
}
function openDeskProjects(){
  renderDeskProjects();
  $('projectsDialog').showModal();
}
function renderDeskProjects(){
  const root=$('deskProjectList');
  root.replaceChildren();
  if(!books.length){const p=document.createElement('p');p.className='hint';p.textContent='No manuscripts yet. Create your first book to begin.';root.append(p)}
  books.forEach(b=>{
    const button=document.createElement('button');
    button.type='button';button.className='deskProjectItem';
    if(b.id===book?.id)button.classList.add('current');
    const name=document.createElement('strong');name.textContent=b.title;
    const indicator=document.createElement('span');indicator.textContent=b.id===book?.id?'Currently open':'Open manuscript';
    button.append(name,indicator);
    button.onclick=async()=>{
      try{
        await saveNow();
        book=books.find(item=>item.id===b.id);
        chapter=null;scene=null;await loadBook();
        $('books').value=book.id;
        renderDeskProjects();
        $('projectsDialog').close();activateModule('write');
        toast('Opened '+book.title);
      }catch(e){handleError(e)}
    };
    root.append(button);
  });
}
$('newDeskProject').onclick=()=>{$('projectsDialog').close();$('addBook').click()};
$('renameDeskProject').onclick=()=>{$('projectsDialog').close();$('renameBook').click()};

function renderDeskNotes(){
  const root=$('deskNotesList');root.replaceChildren();
  const visibleNotes=notes.filter(n=>n.category!=='grimoire');
  if(!visibleNotes.length){const hint=document.createElement('p');hint.className='hint';hint.textContent='No notes yet.';root.append(hint)}
  for(const n of visibleNotes){
    const button=document.createElement('button');button.type='button';
    button.className=n.id===selectedDeskNote?'selected':'';
    button.textContent=n.title||'Untitled Note';
    button.onclick=()=>selectDeskNote(n.id);
    root.append(button);
  }
}
function selectDeskNote(id){
  selectedDeskNote=id;
  const note=notes.find(n=>n.id===id);
  $('deskNoteTitle').value=note?.title||'';
  $('deskNoteBody').value=note?.body||'';
  $('deleteDeskNote').disabled=!note;
  $('deskNoteStatus').textContent=note?'Editing saved note':'New note, not yet saved';
  renderDeskNotes();
}
function openDeskNotes(){
  if(!book){toast('Create a manuscript first');return}
  selectedDeskNote=null;
  selectDeskNote(notes.find(n=>n.category!=='grimoire')?.id||null);
  $('deskNotesDialog').showModal();
}
$('newDeskNote').onclick=()=>{selectDeskNote(null);$('deskNoteTitle').focus()};
$('deskNoteForm').onsubmit=async e=>{
  e.preventDefault();
  if(!book)return;
  const title=$('deskNoteTitle').value.trim();
  const body=$('deskNoteBody').value;
  if(!title)return;
  try{
    await saveNow();
    if(selectedDeskNote){
      await query(db('notes').update({title,body,updated_at:new Date().toISOString()}).eq('id',selectedDeskNote).eq('book_id',book.id));
    }else{
      const record=await query(db('notes').insert({book_id:book.id,category:'general',title,body}).select().single());
      selectedDeskNote=record.id;
    }
    notes=await query(db('notes').select('*').eq('book_id',book.id).order('updated_at',{ascending:false}));
    renderNotes();selectDeskNote(selectedDeskNote);
    $('deskNoteStatus').textContent='Saved to this manuscript';
    toast('Note saved');
  }catch(err){handleError(err);$('deskNoteStatus').textContent='Save failed'}
};
$('deleteDeskNote').onclick=async()=>{
  if(!book||!selectedDeskNote)return;
  if(!confirm('Delete this note?'))return;
  try{
    await query(db('notes').delete().eq('id',selectedDeskNote).eq('book_id',book.id));
    notes=await query(db('notes').select('*').eq('book_id',book.id).order('updated_at',{ascending:false}));
    renderNotes();selectDeskNote(null);
    toast('Note deleted');
  }catch(e){handleError(e)}
};
async function openDeskSearch(){
  if(!book){toast('Create a manuscript first');return}
  await saveNow();
  $('searchQuery').value='';
  $('searchResults').innerHTML='<p class="hint">Type to search this manuscript.</p>';
  if(!$('searchDialog').open)$('searchDialog').showModal();
  $('searchQuery').focus();
}
function showDeskExport(){
  if(!book){toast('Create a manuscript first');return}
  if(!$('exportDialog').open)$('exportDialog').showModal();
}
function showDeskHelp(){
  $('deskHelpDialog').showModal();
}
function toggleDeskFocus(){
  const active=$('workspace').classList.toggle('writingFocus');
  focusButton.setAttribute('aria-pressed',String(active));
  focusButton.textContent=active?'☾ Exit Focus':'☾ Focus Mode';
  if(scene)$('editor').focus();
}
function toggleDeskFullscreen(){
  if(document.fullscreenElement)return document.exitFullscreen();
  return $('workspace').requestFullscreen();
}
async function openDeskSection(name){
  if(name!=='write'&&dirty)await saveNow();
  if(name==='write'){
    activateModule('write');
    if(scene)$('editor').focus();
    else toast('Create a manuscript and scene to start writing');
    return;
  }
  if(name==='projects'){activateModule(name);openDeskProjects();return}
  if(name==='world'){activateModule(name);openWorldOverview();return}
  if(name==='notes'){activateModule(name);openDeskNotes();return}
  if(name==='research'){activateModule(name);await openDeskSearch();return}
  if(name==='vault'){activateModule(name);showDeskExport();return}
  const category={
    characters:'characters',
    locations:'settings',
    items:'items',
    plots:'plotlines',
    lore:'lore'
  }[name];
  if(category){
    activateModule(name);
    openStoryCategory(category);
  }
}
document.querySelectorAll('[data-module]').forEach(button=>{
  const name=button.dataset.module;
  // Research already has its own click handler; keep only that handler.
  if(name==='research')return;
  button.addEventListener('click',()=>openDeskSection(name).catch(handleError));
});
// Preserve and upgrade the existing working Research button.
$('searchOpen').onclick=()=>openDeskSection('research').catch(handleError);
$('openCharacters').onclick=null;
$('openCharactersRail').onclick=()=>openDeskSection('characters').catch(handleError);
const railCategoryActions={
  scenes:'scenes',characters:'characters',settings:'locations',
  items:'items',plotlines:'plots',lore:'lore',research:'research'
};
document.querySelectorAll('[data-rail]').forEach(button=>{
  if(button.id==='openCharactersRail')return;
  button.addEventListener('click',async()=>{
    try{
      const name=railCategoryActions[button.dataset.rail];
      if(name==='scenes'){
        activateModule('write');
        $('scenes').scrollIntoView({behavior:'smooth',block:'nearest'});
        if(scene)$('editor').focus();
      }else if(name){await openDeskSection(name)}
    }catch(err){handleError(err)}
  });
});
const focusButton=document.querySelector('.focusMode');
focusButton?.addEventListener('click',toggleDeskFocus);
document.querySelector('.fullscreenButton')?.addEventListener('click',()=>Promise.resolve(toggleDeskFullscreen()).catch(handleError));
document.querySelector('.newTab')?.addEventListener('click',()=>{$('addScene').click()});
$('exportMenu').onclick=showDeskExport;
const notificationButton=document.querySelector('.headerActions .iconButton[title="Notifications"]');
notificationButton?.addEventListener('click',()=>toast('The desk saves changes automatically. Check the status indicator for sync progress.'));
const settingsButton=document.querySelector('.headerActions .iconButton[title="Settings"]');
settingsButton?.addEventListener('click',showDeskHelp);

// Keep formatting menus in sync with the existing rich-text editor.
const formatSelect=document.querySelector('.formatSelect');
const fontSelect=document.querySelector('.fontSelect');
const sizeSelect=document.querySelector('.sizeSelect');
formatSelect?.addEventListener('change',()=>editorBlock(formatSelect.value));
fontSelect?.addEventListener('change',()=>editorCommand('fontName',fontSelect.value));
sizeSelect?.addEventListener('change',()=>{
  const sizes={'12':'2','14':'3','16':'4','18':'5'};
  editorCommand('fontSize',sizes[sizeSelect.value]||'3');
});
const colorPicker=document.createElement('input');
colorPicker.type='color';colorPicker.value='#2b2118';
colorPicker.setAttribute('aria-label','Choose text color');
colorPicker.className='deskColorPicker';
document.querySelector('.toolbar .goldTool')?.after(colorPicker);
document.querySelector('.toolbar .goldTool')?.addEventListener('click',()=>colorPicker.click());
colorPicker.addEventListener('input',()=>editorCommand('foreColor',colorPicker.value));

// The menu actions reuse manuscript handlers rather than implementing parallel saves.
const deskMenuDefs={
  file:[
    ['New manuscript','new-book'],['New chapter','new-chapter'],['New scene','new-scene'],
    ['Save changes','save'],['Rename manuscript','rename-book'],
    ['Export & backup…','export'],['Print / Save PDF…','print']
  ],
  edit:[
    ['Undo','undo'],['Redo','redo'],['Select all text','select-all'],
    ['Bold','bold'],['Italic','italic'],['Underline','underline'],
    ['Find & replace…','find']
  ],
  view:[
    ['Focus mode','focus'],['Fullscreen','fullscreen'],
    ['Toggle manuscript sidebar','left-rail'],['Toggle inspector sidebar','right-rail']
  ],
  insert:[
    ['New paragraph','paragraph'],['Horizontal divider','rule'],
    ['Bulleted list','bullets'],['Numbered list','numbered'],
    ['Quotation','quote'],['Today’s date','date']
  ],
  format:[
    ['Normal paragraph','style-p'],['Chapter title','style-h1'],
    ['Section heading','style-h2'],['Block quote','style-quote'],
    ['Align left','align-left'],['Align center','align-center'],
    ['Align right','align-right'],['Clear formatting','clear-format']
  ],
  tools:[
    ['Find & replace…','find'],['Search manuscript…','search'],
    ['Save revision checkpoint','checkpoint'],['Revision history…','revisions'],
    ['Word count','word-count']
  ],
  help:[
    ['Writing guide & shortcuts','guide'],['About The Witch’s Desk','about']
  ]
};
const editorOnlyMenuActions=new Set([
  'undo','redo','select-all','bold','italic','underline','find','paragraph','rule','bullets','numbered','quote',
  'date','style-p','style-h1','style-h2','style-quote','align-left','align-center','align-right','clear-format',
  'checkpoint','revisions','word-count'
]);
function closeDeskMenu(){
  deskMenu.hidden=true;
  menuTriggers.forEach(button=>button.setAttribute('aria-expanded','false'));
}
function openDeskMenu(trigger){
  if(!deskMenu.hidden&&trigger.getAttribute('aria-expanded')==='true'){closeDeskMenu();return}
  deskMenu.replaceChildren();
  const actions=deskMenuDefs[trigger.dataset.menu]||[];
  for(const [label,action] of actions){
    const item=document.createElement('button');
    item.type='button';item.setAttribute('role','menuitem');
    item.textContent=label;
    item.disabled=editorOnlyMenuActions.has(action)&&!scene;
    item.addEventListener('pointerdown',e=>e.preventDefault());
    item.addEventListener('click',()=>{
      closeDeskMenu();
      Promise.resolve(runDeskMenuAction(action)).catch(handleError);
    });
    deskMenu.append(item);
  }
  menuTriggers.forEach(button=>button.setAttribute('aria-expanded',String(button===trigger)));
  deskMenu.hidden=false;
  const rect=trigger.getBoundingClientRect();
  const width=deskMenu.getBoundingClientRect().width;
  const left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8));
  deskMenu.style.left=left+'px';
  deskMenu.style.top=Math.min(rect.bottom+4,window.innerHeight-deskMenu.offsetHeight-8)+'px';
  deskMenu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
}
menuTriggers.forEach(trigger=>{
  trigger.addEventListener('click',()=>openDeskMenu(trigger));
  trigger.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){e.preventDefault();openDeskMenu(trigger)}
  });
});
document.addEventListener('pointerdown',e=>{
  if(!deskMenu.hidden&&!deskMenu.contains(e.target)&&!e.target.closest('.menuTrigger'))closeDeskMenu();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!deskMenu.hidden){e.preventDefault();closeDeskMenu();return}
  if(!deskMenu.hidden&&(e.key==='ArrowDown'||e.key==='ArrowUp')){
    e.preventDefault();
    const items=[...deskMenu.querySelectorAll('button:not(:disabled)')];
    const position=items.indexOf(document.activeElement);
    const index=(position+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
    items[index]?.focus();
  }
});
async function runDeskMenuAction(action){
  const via=id=>$(id)?.click();
  switch(action){
    case 'new-book':return via('addBook');
    case 'new-chapter':return via('addChapter');
    case 'new-scene':return via('addScene');
    case 'save':await saveNow();toast('All changes saved');return;
    case 'rename-book':return via('renameBook');
    case 'export':return showDeskExport();
    case 'print':return via('printManuscript');
    case 'undo':return editorCommand('undo');
    case 'redo':return editorCommand('redo');
    case 'select-all':if(!scene)return;focusManuscript();document.execCommand('selectAll');return;
    case 'bold':return editorCommand('bold');
    case 'italic':return editorCommand('italic');
    case 'underline':return editorCommand('underline');
    case 'find':return via('findReplace');
    case 'focus':return toggleDeskFocus();
    case 'fullscreen':return toggleDeskFullscreen();
    case 'left-rail':$('workspace').classList.toggle('hideLeftRail');return;
    case 'right-rail':$('workspace').classList.toggle('hideRightRail');return;
    case 'paragraph':return editorCommand('insertParagraph');
    case 'rule':return editorCommand('insertHorizontalRule');
    case 'bullets':return editorCommand('insertUnorderedList');
    case 'numbered':return editorCommand('insertOrderedList');
    case 'quote':case 'style-quote':return editorBlock('blockquote');
    case 'date':return editorCommand('insertText',new Date().toLocaleDateString());
    case 'style-p':return editorBlock('p');
    case 'style-h1':return editorBlock('h1');
    case 'style-h2':return editorBlock('h2');
    case 'align-left':return editorCommand('justifyLeft');
    case 'align-center':return editorCommand('justifyCenter');
    case 'align-right':return editorCommand('justifyRight');
    case 'clear-format':return editorCommand('removeFormat');
    case 'search':return openDeskSearch();
    case 'checkpoint':return via('snapshot');
    case 'revisions':return via('revisions');
    case 'word-count':return toast('Current scene: '+countWords($('editor').innerText).toLocaleString()+' words');
    case 'guide':case 'about':return showDeskHelp();
  }
}

/* Mobile desk navigation - 2026-11-12 */
const mobileViewport=window.matchMedia('(max-width:760px)');
const mobileManuscript=$('manuscriptRail');
const mobileInspector=$('inspectorRail');
const mobileBackdrop=$('mobileDrawerBackdrop');
const mobileChaptersButton=$('mobileOpenManuscript');
const mobileDetailsButton=$('mobileOpenInspector');
function closeMobileDrawers(){
  mobileManuscript.classList.remove('mobileOpen');
  mobileInspector.classList.remove('mobileOpen');
  mobileBackdrop.hidden=true;
  mobileChaptersButton.setAttribute('aria-expanded','false');
  mobileDetailsButton.setAttribute('aria-expanded','false');
}
function toggleMobileDrawer(which){
  if(!mobileViewport.matches)return;
  const target=which==='chapters'?mobileManuscript:mobileInspector;
  const open=!target.classList.contains('mobileOpen');
  closeDeskMenu();
  closeMobileDrawers();
  if(open){
    target.classList.add('mobileOpen');
    mobileBackdrop.hidden=false;
    (which==='chapters'?mobileChaptersButton:mobileDetailsButton).setAttribute('aria-expanded','true');
  }
}
mobileChaptersButton.addEventListener('click',()=>toggleMobileDrawer('chapters'));
mobileDetailsButton.addEventListener('click',()=>toggleMobileDrawer('details'));
mobileBackdrop.addEventListener('click',closeMobileDrawers);
$('mobileSaveScene').addEventListener('click',async()=>{
  if(!scene){toast('Create a scene before writing');return}
  try{await saveNow();toast('Scene saved')}catch(e){handleError(e)}
});
$('sceneTitle').addEventListener('input',()=>{
  $('mobileSceneLabel').textContent=$('sceneTitle').value.trim()||'Untitled Scene';
});
mobileManuscript.addEventListener('click',e=>{
  const target=e.target;
  if(target.closest('#scenes button,#chapters button,#addScene,#addChapter,.railLink,#openGrimoire,.grimoireButton')){
    closeMobileDrawers();
  }
});
mobileManuscript.querySelector('#books').addEventListener('change',closeMobileDrawers);
mobileInspector.addEventListener('click',e=>{
  if(e.target.closest('#openGrimoire,#characters button,#addCharacter,#addNote'))closeMobileDrawers();
});
document.querySelectorAll('[data-module]').forEach(button=>{
  button.addEventListener('click',closeMobileDrawers);
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&(!mobileBackdrop.hidden)){
    e.preventDefault();
    closeMobileDrawers();
  }
});
if(mobileViewport.addEventListener){
  mobileViewport.addEventListener('change',()=>closeMobileDrawers());
}
window.addEventListener('pagehide',closeMobileDrawers);

init();
