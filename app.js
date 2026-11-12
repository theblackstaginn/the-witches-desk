import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const SCHEMA = 'witches_desk';
const DEFAULT_CONFIG = {
  url: 'https://pqifpislzljilqatmtly.supabase.co',
  key: 'sb_publishable_16wAhIyuMsClbOYoAZt6aQ_unXWTJ_n'
};
const CONFIG_KEY = 'witches-desk-config-v2';
const PREF_KEY = 'witches-desk-preferences-v1';
const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };
const CATEGORIES = [
  ['characters', 'Characters'], ['settings', 'Settings'], ['items', 'Items'],
  ['plotlines', 'Plotlines'], ['lore', 'Lore']
];
const $ = (id) => document.getElementById(id);

let client, activeUser, editor, editorExtensions = [], tiptap, bootError;
let books = [], chapters = [], scenes = [], characters = [], notes = [];
let worldEntries = [], worldLinks = [];
let currentBook = null, currentChapter = null, currentScene = null;
let selectedNoteId = null, worldCategory = 'characters', worldSelectedId = null;
let dirty = false, loadingEditor = false, editGeneration = 0;
let saveTimer = 0, savePromise = null, conflictOpen = false, pendingConflict = null;
let lastLoadedUserId = null, toastTimer = 0;

const text = (value) => String(value == null ? '' : value);
const safeText = (value) => text(value).replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));
const safeFilename = (value) => {
  const name = text(value || 'manuscript').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 90);
  return name || 'manuscript';
};
const emptyDoc = () => ({ type: 'doc', content: [{ type: 'paragraph' }] });

function toast(message, kind) {
  const node = $('toast');
  node.textContent = message;
  node.dataset.kind = kind || 'info';
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 4200);
}
function showView(view) {
  $('setupView').hidden = view !== 'setup';
  $('authView').hidden = view !== 'auth';
  $('desk').hidden = view !== 'desk';
}
function setSaveState(label, mode) {
  $('saveState').textContent = label;
  $('saveState').dataset.state = mode || 'idle';
  $('syncStatus').textContent = label === 'Saved' ? 'All changes are synced'
    : label === 'Saving…' ? 'Syncing changes to your private desk'
      : label === 'Offline draft' ? 'Local recovery draft is saved'
        : 'Changes sync to your private desk';
}
function setConnectionState(online, label) {
  const node = $('connectionState');
  node.classList.toggle('offline', !online);
  node.querySelector('span').textContent = label || (online ? 'Connected' : 'Offline');
}
function getConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    return stored && stored.url && stored.key ? stored : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}
function db(table) {
  if (!client) throw new Error('The private writing desk is not connected.');
  return client.schema(SCHEMA).from(table);
}
async function query(request) {
  const result = await request;
  if (result.error) throw result.error;
  return result.data;
}
function friendlyError(error) {
  const message = text(error && error.message || error || 'Something went wrong.');
  if (/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(message))
    return 'The connection dropped. Your recovery draft is saved on this device; reconnect and try Save now.';
  if (/schema cache|schema .* not found|not exposed/i.test(message))
    return 'The Witch’s Desk schema is not exposed to the Supabase Data API. Add witches_desk to the project’s exposed schemas.';
  if (/Invalid login credentials/i.test(message)) return 'The email or password could not be verified.';
  if (/Email not confirmed/i.test(message)) return 'Confirm the email address from the Supabase message, then sign in again.';
  return message;
}
function reportError(error) {
  console.error(error);
  toast(friendlyError(error), 'error');
  if (!navigator.onLine) setSaveState('Offline draft', 'offline');
}
function dateLabel(value, includeTime) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}
function randomId() {
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.random() * 16 | 0;
    return (ch === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}

function safeLinkUrl(value) {
  try {
    const url = new URL(text(value), window.location.href);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol);
  } catch {
    return false;
  }
}
function cleanPastedHTML(html) {
  const parsed = new DOMParser().parseFromString(text(html), 'text/html');
  parsed.querySelectorAll('script,style,iframe,object,embed,form,meta,link,svg,math').forEach((node) => node.remove());
  parsed.body.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'class' || name.startsWith('data-'))
        node.removeAttribute(attr.name);
    });
    if (node.tagName === 'A') {
      if (!safeLinkUrl(node.getAttribute('href'))) node.removeAttribute('href');
      node.setAttribute('rel', 'noopener noreferrer');
      node.setAttribute('target', '_blank');
    }
  });
  return parsed.body.innerHTML;
}

async function loadEditorLibraries() {
  try {
    const urls = [
      'https://cdn.jsdelivr.net/npm/@tiptap/core@3.31.3/+esm',
      'https://cdn.jsdelivr.net/npm/@tiptap/starter-kit@3.31.3/+esm',
      'https://cdn.jsdelivr.net/npm/@tiptap/extensions@3.31.3/+esm',
      'https://cdn.jsdelivr.net/npm/@tiptap/extension-text-align@3.31.3/+esm',
      'https://cdn.jsdelivr.net/npm/@tiptap/extension-highlight@3.31.3/+esm'
    ];
    const mods = await Promise.all(urls.map((url) => import(url)));
    tiptap = {
      Editor: mods[0].Editor,
      generateHTML: mods[0].generateHTML,
      generateJSON: mods[0].generateJSON,
      StarterKit: mods[1].default,
      CharacterCount: mods[2].CharacterCount,
      Placeholder: mods[2].Placeholder,
      TextAlign: mods[3].default,
      Highlight: mods[4].default
    };
    if (!tiptap.Editor || !tiptap.StarterKit || !tiptap.generateHTML || !tiptap.generateJSON)
      throw new Error('The rich text editor did not finish loading.');
    editorExtensions = [
      tiptap.StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          defaultProtocol: 'https',
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
          isAllowedUri: (url) => safeLinkUrl(url)
        }
      }),
      tiptap.TextAlign.configure({ types: ['heading', 'paragraph'] }),
      tiptap.Highlight.configure({ multicolor: false }),
      tiptap.CharacterCount.configure({
        wordCounter: (value) => value.trim() ? value.trim().split(/\s+/u).length : 0
      }),
      tiptap.Placeholder.configure({ placeholder: 'Let the words gather…' })
    ];
    return true;
  } catch (error) {
    bootError = error;
    console.error(error);
    return false;
  }
}
function normalizedDoc(content) {
  if (content && content.type === 'doc') return content;
  if (content && content.document && content.document.type === 'doc') return content.document;
  if (content && typeof content.html === 'string')
    return tiptap.generateJSON(cleanPastedHTML(content.html), editorExtensions);
  if (typeof content === 'string')
    return tiptap.generateJSON(cleanPastedHTML(content), editorExtensions);
  return emptyDoc();
}
function documentText(content) {
  const doc = normalizedDoc(content);
  function walk(node) {
    if (!node) return '';
    if (node.type === 'text') return node.text || '';
    const children = (node.content || []).map(walk);
    return ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'].includes(node.type)
      ? children.join('\n') : children.join('');
  }
  return walk(doc).replace(/\n{3,}/g, '\n\n');
}
function wordCount(content) {
  const body = documentText(content).trim();
  return body ? body.split(/\s+/u).length : 0;
}
function makeEditor() {
  if (editor || !tiptap) return;
  editor = new tiptap.Editor({
    element: $('editor'),
    extensions: editorExtensions,
    content: emptyDoc(),
    editable: false,
    editorProps: {
      attributes: {
        class: 'tiptap-content',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Manuscript text',
        spellcheck: 'true'
      },
      transformPastedHTML: cleanPastedHTML
    },
    onUpdate() {
      if (loadingEditor || !currentScene) return;
      editGeneration += 1;
      dirty = true;
      updateCounts();
      updateOutline();
      storeDraft();
      setSaveState('Unsaved changes', 'dirty');
      scheduleSave();
    },
    onSelectionUpdate: updateToolbarState,
    onFocus: () => $('editor').classList.add('has-focus'),
    onBlur: () => $('editor').classList.remove('has-focus')
  });
}
function setEditorDocument(content) {
  if (!editor) return;
  loadingEditor = true;
  editor.setEditable(!!currentScene);
  editor.commands.setContent(normalizedDoc(content), { emitUpdate: false, errorOnInvalidContent: false });
  loadingEditor = false;
  updateCounts();
  updateOutline();
  updateToolbarState();
}
function updateCounts() {
  const doc = editor ? editor.getJSON() : emptyDoc();
  let words = wordCount(doc), chars = documentText(doc).length;
  try {
    words = editor.storage.characterCount.words();
    chars = editor.storage.characterCount.characters();
  } catch {}
  $('wordCount').textContent = words.toLocaleString() + (words === 1 ? ' word' : ' words');
  $('characterCount').textContent = chars.toLocaleString() + (chars === 1 ? ' character' : ' characters');
  $('sceneStatWords').textContent = words.toLocaleString();
  const pov = currentScene && characters.find((c) => c.id === currentScene.pov_character_id);
  $('povFooter').textContent = pov ? 'POV: ' + pov.name : 'POV unassigned';
}
function updateOutline() {
  const root = $('documentOutline');
  root.replaceChildren();
  const headings = currentScene ? $('editor').querySelectorAll('h1,h2,h3') : [];
  [...headings].forEach((heading, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'outline-item level-' + heading.tagName.toLowerCase();
    button.textContent = heading.textContent || 'Untitled heading';
    button.addEventListener('click', () => {
      $('editor').querySelectorAll('h1,h2,h3')[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    root.append(button);
  });
  $('outlineEmpty').hidden = headings.length > 0;
}
function updateToolbarState() {
  if (!editor) return;
  const active = {
    bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike',
    highlight: 'highlight', bulletList: 'bulletList', orderedList: 'orderedList', blockquote: 'blockquote'
  };
  document.querySelectorAll('[data-command]').forEach((button) => {
    button.classList.toggle('is-active', !!active[button.dataset.command] &&
      editor.isActive(active[button.dataset.command]));
  });
  $('blockStyle').value = editor.isActive('heading', { level: 1 }) ? 'heading1'
    : editor.isActive('heading', { level: 2 }) ? 'heading2'
      : editor.isActive('heading', { level: 3 }) ? 'heading3' : 'paragraph';
}

function localDraftKey(id) { return 'witches-desk-draft:' + activeUser.id + ':' + id; }
function autoCheckpointKey(id) { return 'witches-desk-autocheckpoint:' + activeUser.id + ':' + id; }
function readDraft(id) {
  try { return JSON.parse(localStorage.getItem(localDraftKey(id)) || 'null'); } catch { return null; }
}
function storeDraft() {
  if (!activeUser || !currentScene || !editor) return;
  const draft = {
    document: editor.getJSON(),
    title: $('sceneTitle').value.trim() || 'Untitled Scene',
    pov_character_id: $('povSelect').value || null,
    updated: Date.now()
  };
  try { localStorage.setItem(localDraftKey(currentScene.id), JSON.stringify(draft)); }
  catch (error) {
    console.warn('Local recovery storage is full.', error);
    setSaveState('Draft storage full', 'offline');
  }
}
function clearDraft(id) {
  if (!activeUser || !id) return;
  try { localStorage.removeItem(localDraftKey(id)); } catch {}
}
function scheduleSave(delay) {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveNow().catch(reportError), delay == null ? 1000 : delay);
}

function revisionPayload(doc, title, povId, label) {
  return {
    type: 'witches-desk-revision',
    document: normalizedDoc(doc),
    title: title || 'Untitled Scene',
    pov_character_id: povId || null,
    label: label || 'Checkpoint'
  };
}
async function addRevision(scene, label, doc, title, povId) {
  await query(db('scene_revisions').insert({
    book_id: scene.book_id,
    scene_id: scene.id,
    content: revisionPayload(doc || scene.content, title || scene.title,
      povId === undefined ? scene.pov_character_id : povId, label)
  }));
}
async function maybeAutoCheckpoint(scene, doc, title, povId) {
  const key = autoCheckpointKey(scene.id);
  let last = 0;
  try { last = Number(localStorage.getItem(key) || 0); } catch {}
  if (Date.now() - last < 15 * 60 * 1000 || wordCount(doc) < 30) return;
  await addRevision(scene, 'Automatic checkpoint', doc, title, povId);
  try { localStorage.setItem(key, String(Date.now())); } catch {}
}

function openConflict(remote) {
  if (conflictOpen) return;
  conflictOpen = true;
  pendingConflict = remote;
  storeDraft();
  $('conflictMessage').textContent =
    'A newer cloud version was saved ' + dateLabel(remote.updated_at, true) + '. Your current writing is safe on this device.';
  $('conflictDialog').showModal();
}
function resolveConflict(useCloud) {
  const remote = pendingConflict;
  if (!remote) return;
  pendingConflict = null;
  conflictOpen = false;
  $('conflictDialog').close();
  const local = scenes.find((item) => item.id === remote.id);
  if (useCloud) {
    if (local) Object.assign(local, remote);
    currentScene = local || remote;
    $('sceneTitle').value = remote.title;
    $('povSelect').value = remote.pov_character_id || '';
    setEditorDocument(remote.content);
    dirty = false;
    clearDraft(remote.id);
    setSaveState('Saved', 'saved');
    renderScenes();
    toast('Loaded the cloud version.');
  } else {
    if (local && currentScene && local.id === currentScene.id) {
      local.updated_at = remote.updated_at;
      currentScene = local;
    }
    dirty = true;
    storeDraft();
    setSaveState('Unsaved changes', 'dirty');
    setTimeout(() => saveNow().catch(reportError), 60);
  }
}
async function saveSceneRequest() {
  if (!currentScene || !activeUser || !editor || !dirty) return true;
  const scene = currentScene;
  const generation = editGeneration;
  const doc = editor.getJSON();
  const title = $('sceneTitle').value.trim() || 'Untitled Scene';
  const povId = $('povSelect').value || null;
  const base = scene.updated_at;
  setSaveState('Saving…', 'saving');
  try {
    await maybeAutoCheckpoint(scene, doc, title, povId);
    let request = db('scenes').update({
      title,
      content: doc,
      pov_character_id: povId,
      word_count: wordCount(doc),
      updated_at: new Date().toISOString()
    }).eq('id', scene.id);
    if (base) request = request.eq('updated_at', base);
    const result = await request.select('*').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
      const remote = await query(db('scenes').select('*').eq('id', scene.id).maybeSingle());
      if (remote) { openConflict(remote); return false; }
      throw new Error('This scene could not be found in your private desk.');
    }
    Object.assign(scene, result.data);
    if (currentScene && currentScene.id === scene.id) currentScene = scene;
    if (generation === editGeneration) {
      dirty = false;
      clearDraft(scene.id);
      setSaveState('Saved', 'saved');
    } else {
      dirty = true;
      storeDraft();
      setSaveState('Unsaved changes', 'dirty');
    }
    updateCounts();
    updateStats().catch(() => {});
    setConnectionState(navigator.onLine, navigator.onLine ? 'Connected' : 'Offline');
    return !dirty;
  } catch (error) {
    storeDraft();
    setSaveState(navigator.onLine ? 'Save failed' : 'Offline draft', 'offline');
    setConnectionState(false, 'Offline');
    reportError(error);
    return false;
  }
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!dirty || !currentScene) return true;
  if (savePromise) {
    const ok = await savePromise;
    if (!ok) return false;
    return dirty ? saveNow() : true;
  }
  const request = saveSceneRequest();
  savePromise = request;
  const ok = await request;
  if (savePromise === request) savePromise = null;
  if (ok && dirty) return saveNow();
  return ok;
}
async function refreshCloudScene() {
  if (!currentScene || !activeUser || !navigator.onLine || document.hidden || conflictOpen) return;
  try {
    const remote = await query(db('scenes').select('*').eq('id', currentScene.id).maybeSingle());
    if (!remote || remote.updated_at === currentScene.updated_at) return;
    if (Date.parse(remote.updated_at || '') <= Date.parse(currentScene.updated_at || '')) return;
    if (dirty) return openConflict(remote);
    const local = scenes.find((item) => item.id === remote.id);
    if (local) Object.assign(local, remote);
    currentScene = local || remote;
    $('sceneTitle').value = remote.title;
    $('povSelect').value = remote.pov_character_id || '';
    setEditorDocument(remote.content);
    setSaveState('Saved', 'saved');
    toast('This scene was refreshed from your cloud desk.');
  } catch (error) {
    console.warn('Cloud refresh is temporarily unavailable.', error);
  }
}

function renderBookSelect() {
  const select = $('bookSelect');
  select.replaceChildren();
  books.forEach((book) => select.add(new Option(book.title || 'Untitled Manuscript', book.id)));
  if (currentBook) select.value = currentBook.id;
  $('currentManuscript').textContent = currentBook ? currentBook.title : 'Your writing desk';
  $('bookDescription').textContent = currentBook ? currentBook.description || '' : '';
  $('bookDescription').hidden = !currentBook || !currentBook.description;
}
function renderPovOptions() {
  const select = $('povSelect');
  const value = currentScene ? currentScene.pov_character_id || '' : '';
  select.replaceChildren(new Option('Unassigned', ''));
  characters.forEach((character) => select.add(new Option(character.name, character.id)));
  select.value = value;
  $('povModeSelect').value = currentBook ? currentBook.pov_mode || 'single' : 'single';
}
function makeTreeRow(kind, record, selected, index, total) {
  const row = document.createElement('div');
  row.className = 'tree-row' + (selected ? ' selected' : '');
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'tree-open';
  open.textContent = record.title || (kind === 'chapter' ? 'Untitled Chapter' : 'Untitled Scene');
  open.dataset.navOpen = kind;
  open.dataset.id = record.id;
  open.setAttribute('aria-current', selected ? 'page' : 'false');
  row.append(open);

  const details = document.createElement('details');
  details.className = 'row-menu';
  const summary = document.createElement('summary');
  summary.textContent = '•••';
  summary.setAttribute('aria-label', 'Options for ' + open.textContent);
  details.append(summary);
  const card = document.createElement('div');
  card.className = 'row-menu-card';
  [['rename', 'Rename'], ['up', 'Move up'], ['down', 'Move down'],
    ['delete', kind === 'chapter' ? 'Delete chapter' : 'Delete scene']].forEach(([action, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.navAction = action;
    button.dataset.kind = kind;
    button.dataset.id = record.id;
    button.disabled = (action === 'up' && index === 0) || (action === 'down' && index === total - 1);
    if (action === 'delete') button.className = 'danger-text';
    card.append(button);
  });
  details.append(card);
  row.append(details);
  return row;
}
function renderChapters() {
  const root = $('chapterList');
  root.replaceChildren();
  chapters.forEach((chapter, index) => root.append(makeTreeRow('chapter', chapter,
    !!currentChapter && currentChapter.id === chapter.id, index, chapters.length)));
}
function renderScenes() {
  const root = $('sceneList');
  root.replaceChildren();
  scenes.forEach((scene, index) => root.append(makeTreeRow('scene', scene,
    !!currentScene && currentScene.id === scene.id, index, scenes.length)));
}
function setEditingState() {
  const enabled = !!(currentBook && currentScene && editor);
  ['sceneTitle', 'povSelect', 'saveButton', 'checkpointButton', 'revisionsButton']
    .forEach((id) => { $(id).disabled = !enabled; });
  $('povModeSelect').disabled = !currentBook;
  $('newChapterButton').disabled = !currentBook;
  $('newSceneButton').disabled = !currentChapter;
  $('bookSelect').disabled = !books.length;
  $('emptyState').hidden = !!currentScene;
  if (editor) editor.setEditable(!!currentScene);
}

async function loadBooks(preferredId) {
  books = await query(db('books').select('*').order('updated_at', { ascending: false }));
  currentBook = books.find((book) => book.id === (preferredId || currentBook?.id)) || books[0] || null;
  renderBookSelect();
  if (currentBook) await loadBook();
  else {
    chapters = []; scenes = []; characters = []; notes = [];
    currentChapter = null; currentScene = null;
    $('chapterList').replaceChildren(); $('sceneList').replaceChildren();
    $('notesList').replaceChildren(); $('noteEditor').hidden = true;
    $('sceneTitle').value = '';
    $('chapterCrumb').textContent = 'Choose a chapter';
    $('sceneCrumb').textContent = 'Choose a scene';
    if (editor) setEditorDocument(emptyDoc());
    $('emptyState').hidden = false;
    updateStats();
  }
  setEditingState();
}
async function loadBook() {
  if (!currentBook) return;
  currentChapter = null; currentScene = null; dirty = false; selectedNoteId = null;
  $('noteEditor').hidden = true;
  $('chapterCrumb').textContent = currentBook.title;
  $('sceneCrumb').textContent = 'Choose a scene';
  $('sceneTitle').value = '';
  const rows = await Promise.all([
    query(db('chapters').select('*').eq('book_id', currentBook.id).order('sort_order')),
    query(db('characters').select('*').eq('book_id', currentBook.id).order('created_at')),
    query(db('notes').select('*').eq('book_id', currentBook.id).order('updated_at', { ascending: false }))
  ]);
  chapters = rows[0] || []; characters = rows[1] || []; notes = rows[2] || [];
  renderChapters(); renderPovOptions(); renderNotes();
  if (chapters.length) await loadChapter(chapters[0], null);
  else {
    scenes = []; currentChapter = null; currentScene = null;
    $('sceneList').replaceChildren();
    if (editor) setEditorDocument(emptyDoc());
    setEditingState(); updateStats().catch(() => {});
  }
}
async function loadChapter(chapter, selectedSceneId) {
  if (!chapter) return;
  currentChapter = chapter;
  $('chapterCrumb').textContent = chapter.title || 'Untitled Chapter';
  scenes = await query(db('scenes').select('*').eq('chapter_id', chapter.id).order('sort_order'));
  currentScene = scenes.find((scene) => scene.id === selectedSceneId) || scenes[0] || null;
  renderChapters(); renderScenes();
  await openCurrentScene();
}
async function openCurrentScene() {
  clearTimeout(saveTimer);
  if (!currentScene) {
    $('sceneTitle').value = '';
    $('sceneCrumb').textContent = 'No scene selected';
    $('povSelect').value = '';
    if (editor) setEditorDocument(emptyDoc());
    dirty = false;
    $('emptyState').hidden = false;
    setSaveState('Ready', 'idle');
    setEditingState();
    return;
  }
  $('emptyState').hidden = true;
  $('sceneTitle').value = currentScene.title || 'Untitled Scene';
  $('sceneCrumb').textContent = currentScene.title || 'Untitled Scene';
  renderPovOptions();
  setEditorDocument(currentScene.content);
  const draft = readDraft(currentScene.id);
  const cloudTime = Date.parse(currentScene.updated_at || '') || 0;
  if (draft && Number(draft.updated) > cloudTime) {
    $('sceneTitle').value = draft.title || currentScene.title || '';
    $('povSelect').value = draft.pov_character_id || '';
    setEditorDocument(draft.document);
    editGeneration += 1; dirty = true;
    setSaveState('Recovered local draft', 'dirty');
    toast('Recovered a newer draft from this device.');
    scheduleSave(1000);
  } else {
    dirty = false;
    setSaveState('Saved', 'saved');
  }
  updateCounts(); renderScenes(); updateStats().catch(() => {});
  setEditingState();
}
async function switchBook(id) {
  if (dirty && !(await saveNow())) { $('bookSelect').value = currentBook.id; return; }
  currentBook = books.find((book) => book.id === id) || null;
  renderBookSelect();
  await loadBook();
}
async function switchChapter(id) {
  if (currentChapter && currentChapter.id === id) return;
  if (dirty && !(await saveNow())) return;
  const chapter = chapters.find((item) => item.id === id);
  if (chapter) await loadChapter(chapter, null);
}
async function switchScene(id) {
  if (currentScene && currentScene.id === id) return;
  if (dirty && !(await saveNow())) return;
  currentScene = scenes.find((item) => item.id === id) || null;
  await openCurrentScene();
}

function askText(title, label, value, multiline, required) {
  return new Promise((resolve) => {
    const dialog = $('promptDialog');
    $('promptTitle').textContent = title;
    $('promptLabel').textContent = label;
    $('promptInput').value = value || '';
    $('promptInput').required = required !== false;
    $('promptTextarea').value = value || '';
    $('promptTextareaLabel').textContent = label;
    $('promptLabelWrap').hidden = !!multiline;
    $('promptTextareaWrap').hidden = !multiline;
    $('promptSubmit').textContent = title.toLowerCase().startsWith('new') ? 'Create' : 'Save';
    const input = multiline ? $('promptTextarea') : $('promptInput');
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? input.value : null), { once: true });
    dialog.showModal();
    setTimeout(() => input.focus(), 20);
  });
}
function askConfirm(title, message, action, danger) {
  return new Promise((resolve) => {
    const dialog = $('confirmDialog');
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    $('confirmSubmit').textContent = action || 'Continue';
    $('confirmSubmit').classList.toggle('danger', !!danger);
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    dialog.showModal();
  });
}

async function createBook() {
  const title = await askText('New manuscript', 'Manuscript title', 'Untitled Manuscript');
  if (!title || !title.trim()) return;
  const description = await askText('A little about this story', 'Short description (optional)', '', true, false);
  try {
    const book = await query(db('books').insert({ title: title.trim(), description: (description || '').trim() }).select().single());
    currentBook = book;
    await loadBooks(book.id);
    toast('Manuscript created.');
  } catch (error) { reportError(error); }
}
async function createChapter() {
  if (!currentBook) return toast('Create a manuscript first.');
  const title = await askText('New chapter', 'Chapter title', 'Untitled Chapter');
  if (!title || !title.trim()) return;
  try {
    const chapter = await query(db('chapters').insert({
      book_id: currentBook.id, title: title.trim(), sort_order: chapters.length
    }).select().single());
    chapters.push(chapter); currentChapter = chapter; scenes = []; currentScene = null;
    renderChapters(); renderScenes(); await openCurrentScene(); setEditingState();
    toast('Chapter created.');
  } catch (error) { reportError(error); }
}
async function createScene() {
  if (!currentBook || !currentChapter) return toast('Create a chapter first.');
  const title = await askText('New scene', 'Scene title', 'Untitled Scene');
  if (!title || !title.trim()) return;
  if (dirty && !(await saveNow())) return;
  try {
    const scene = await query(db('scenes').insert({
      book_id: currentBook.id, chapter_id: currentChapter.id,
      title: title.trim(), sort_order: scenes.length
    }).select().single());
    scenes.push(scene); currentScene = scene; renderScenes(); await openCurrentScene();
    toast('Scene created.');
  } catch (error) { reportError(error); }
}
async function renameRecord(kind, id) {
  const table = kind === 'book' ? 'books' : kind === 'chapter' ? 'chapters' : 'scenes';
  const row = kind === 'book' ? currentBook : kind === 'chapter'
    ? chapters.find((item) => item.id === id) : scenes.find((item) => item.id === id);
  if (!row) return;
  const title = await askText('Rename ' + kind, 'New title', row.title || '');
  if (!title || !title.trim()) return;
  try {
    const saved = await query(db(table).update({ title: title.trim(), updated_at: new Date().toISOString() }).eq('id', id).select().single());
    Object.assign(row, saved);
    if (kind === 'book') renderBookSelect();
    else if (kind === 'chapter') {
      renderChapters();
      if (currentChapter?.id === id) $('chapterCrumb').textContent = saved.title;
    } else {
      renderScenes();
      if (currentScene?.id === id) {
        $('sceneTitle').value = saved.title; $('sceneCrumb').textContent = saved.title;
      }
    }
    toast('Name updated.');
  } catch (error) { reportError(error); }
}
async function reorder(kind, id, direction) {
  const list = kind === 'chapter' ? chapters : scenes;
  const index = list.findIndex((item) => item.id === id), dest = index + direction;
  if (index < 0 || dest < 0 || dest >= list.length) return;
  const result = list.slice(), moved = result[index];
  result[index] = result[dest]; result[dest] = moved;
  try {
    await Promise.all(result.map((row, order) =>
      query(db(kind === 'chapter' ? 'chapters' : 'scenes').update({ sort_order: order }).eq('id', row.id))));
    if (kind === 'chapter') chapters = result.map((row, order) => ({ ...row, sort_order: order }));
    else scenes = result.map((row, order) => ({ ...row, sort_order: order }));
    kind === 'chapter' ? renderChapters() : renderScenes();
    toast('Order updated.');
  } catch (error) { reportError(error); }
}
async function deleteRecord(kind, id) {
  const table = kind === 'book' ? 'books' : kind === 'chapter' ? 'chapters' : 'scenes';
  const row = kind === 'book' ? currentBook : (kind === 'chapter' ? chapters : scenes).find((item) => item.id === id);
  if (!row) return;
  const label = row.title || 'Untitled ' + kind;
  const message = kind === 'book'
    ? 'Delete “' + label + '” and all its chapters, scenes, notes, revisions, and story entries? Download a backup first if you may need it.'
    : kind === 'chapter'
      ? 'Delete “' + label + '” and every scene and revision inside it?'
      : 'Delete “' + label + '” and its revision history?';
  if (!(await askConfirm('Delete ' + kind + '?', message, 'Delete permanently', true))) return;
  try {
    await query(db(table).delete().eq('id', id));
    if (kind === 'book') {
      currentBook = null; await loadBooks();
    } else if (kind === 'chapter') {
      chapters = chapters.filter((item) => item.id !== id);
      currentChapter = chapters[0] || null; currentScene = null;
      renderChapters();
      if (currentChapter) await loadChapter(currentChapter, null);
      else { scenes = []; renderScenes(); setEditorDocument(emptyDoc()); setEditingState(); }
    } else {
      clearDraft(id); scenes = scenes.filter((item) => item.id !== id);
      currentScene = scenes[0] || null; renderScenes(); await openCurrentScene();
    }
    toast('Deleted ' + label + '.');
  } catch (error) { reportError(error); }
}
async function handleNavAction(button) {
  button.closest('details')?.removeAttribute('open');
  const action = button.dataset.navAction, kind = button.dataset.kind, id = button.dataset.id;
  if (action === 'rename') return renameRecord(kind, id);
  if (action === 'up') return reorder(kind, id, -1);
  if (action === 'down') return reorder(kind, id, 1);
  if (action === 'delete') return deleteRecord(kind, id);
}
async function updateStats() {
  if (!currentBook) {
    $('bookWordCount').textContent = '0'; $('bookChapterCount').textContent = '0'; $('bookSceneCount').textContent = '0'; return;
  }
  const rows = await query(db('scenes').select('id,word_count').eq('book_id', currentBook.id));
  $('bookWordCount').textContent = rows.reduce((sum, scene) => sum + Number(scene.word_count || 0), 0).toLocaleString();
  $('bookChapterCount').textContent = chapters.length.toLocaleString();
  $('bookSceneCount').textContent = rows.length.toLocaleString();
}


function renderNotes() {
  const root = $('notesList'); root.replaceChildren();
  notes.forEach((note) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'note-row' + (note.id === selectedNoteId ? ' selected' : '');
    const title = document.createElement('strong'); title.textContent = note.title || 'Untitled note';
    const body = document.createElement('small'); body.textContent = (note.body || '').slice(0, 90) || 'No note text yet';
    button.append(title, body);
    button.addEventListener('click', () => selectNote(note.id));
    root.append(button);
  });
  $('notesEmpty').hidden = notes.length > 0 || !$('noteEditor').hidden;
  if (!currentBook) $('notesEmpty').textContent = 'Create a manuscript to start a notebook.';
}
function selectNote(id) {
  const note = notes.find((item) => item.id === id);
  if (!note) return;
  selectedNoteId = id;
  $('noteTitle').value = note.title || ''; $('noteBody').value = note.body || '';
  $('noteEditor').hidden = false; $('notesEmpty').hidden = true; $('deleteNoteButton').hidden = false;
  renderNotes();
}
function newNote() {
  selectedNoteId = null; $('noteTitle').value = ''; $('noteBody').value = '';
  $('noteEditor').hidden = false; $('notesEmpty').hidden = true; $('deleteNoteButton').hidden = true;
  $('noteTitle').focus();
}
async function saveNote() {
  if (!currentBook) return toast('Create a manuscript before adding notes.');
  const title = $('noteTitle').value.trim();
  if (!title) return toast('Give this note a title first.');
  const payload = {
    book_id: currentBook.id, title, body: $('noteBody').value,
    category: 'general', updated_at: new Date().toISOString()
  };
  try {
    let saved;
    if (selectedNoteId) {
      saved = await query(db('notes').update(payload).eq('id', selectedNoteId).select().single());
      notes = notes.map((note) => note.id === saved.id ? saved : note);
    } else {
      saved = await query(db('notes').insert(payload).select().single());
      notes.unshift(saved); selectedNoteId = saved.id;
    }
    renderNotes(); selectNote(saved.id); toast('Note saved.');
  } catch (error) { reportError(error); }
}
async function deleteNote() {
  if (!selectedNoteId) return;
  if (!(await askConfirm('Delete this note?', 'This note will be removed from the manuscript.', 'Delete note', true))) return;
  try {
    await query(db('notes').delete().eq('id', selectedNoteId));
    notes = notes.filter((note) => note.id !== selectedNoteId); selectedNoteId = null;
    $('noteEditor').hidden = true; renderNotes(); toast('Note deleted.');
  } catch (error) { reportError(error); }
}
async function changePovMode() {
  if (!currentBook) return;
  try {
    const saved = await query(db('books').update({
      pov_mode: $('povModeSelect').value, updated_at: new Date().toISOString()
    }).eq('id', currentBook.id).select().single());
    Object.assign(currentBook, saved); toast('POV structure saved.');
  } catch (error) { reportError(error); }
}

function categoryName(value) {
  return CATEGORIES.find((item) => item[0] === value)?.[1] || value || 'Story';
}
async function loadWorldEntries() {
  if (!currentBook) return;
  const result = await Promise.all([
    query(db('world_entries').select('*').eq('book_id', currentBook.id).order('title')),
    query(db('world_entry_links').select('*').eq('book_id', currentBook.id).order('created_at'))
  ]);
  worldEntries = result[0] || []; worldLinks = result[1] || [];
  const existing = new Set(worldEntries.map((entry) => entry.id));
  const missing = characters.filter((character) => !existing.has(character.id));
  if (missing.length) {
    const rows = missing.map((character) => {
      const parts = String(character.description || '').split(/\n\n/);
      const summary = parts.shift() || '';
      return { id: character.id, book_id: currentBook.id, category: 'characters',
        title: character.name, summary, details: parts.join('\n\n') };
    });
    try {
      await query(db('world_entries').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }));
      worldEntries = await query(db('world_entries').select('*').eq('book_id', currentBook.id).order('title'));
    } catch (error) {
      console.warn('An existing character could not be mirrored into the world archive.', error);
    }
  }
}
function worldFiltered() {
  const term = $('worldSearch').value.trim().toLocaleLowerCase();
  return worldEntries.filter((entry) => entry.category === worldCategory &&
    (!term || (entry.title + ' ' + entry.summary + ' ' + entry.details).toLocaleLowerCase().includes(term)));
}
function renderWorldEntries() {
  const root = $('worldEntryList'); root.replaceChildren();
  const items = worldFiltered();
  items.forEach((entry) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'world-entry-row' + (entry.id === worldSelectedId ? ' selected' : '');
    const title = document.createElement('strong'); title.textContent = entry.title;
    const summary = document.createElement('small'); summary.textContent = entry.summary || 'No summary yet';
    button.append(title, summary); button.addEventListener('click', () => selectWorldEntry(entry.id)); root.append(button);
  });
  $('worldListEmpty').hidden = items.length > 0;
  document.querySelectorAll('[data-world-cat]').forEach((button) => {
    const active = button.dataset.worldCat === worldCategory;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
  });
}
function renderLinkTarget() {
  const select = $('linkTarget'); select.replaceChildren(new Option('Choose an entry…', ''));
  worldEntries.filter((entry) => entry.id !== worldSelectedId)
    .sort((a, b) => a.title.localeCompare(b.title))
    .forEach((entry) => select.add(new Option('[' + categoryName(entry.category) + '] ' + entry.title, entry.id)));
  select.disabled = !worldSelectedId || worldEntries.length < 2;
  $('linkRelation').disabled = select.disabled;
}
function renderWorldRelationships() {
  const root = $('worldRelationships'); root.replaceChildren(); renderLinkTarget();
  if (!worldSelectedId) return;
  const links = worldLinks.filter((link) =>
    link.from_entry_id === worldSelectedId || link.to_entry_id === worldSelectedId);
  links.forEach((link) => {
    const outgoing = link.from_entry_id === worldSelectedId;
    const otherId = outgoing ? link.to_entry_id : link.from_entry_id;
    const other = worldEntries.find((entry) => entry.id === otherId);
    if (!other) return;
    const row = document.createElement('div'); row.className = 'relationship-row';
    const label = document.createElement('span');
    label.textContent = outgoing
      ? (link.relation || 'related to') + ' → ' + other.title
      : other.title + ' → ' + (link.relation || 'related to');
    if (link.notes) {
      const note = document.createElement('small'); note.textContent = link.notes;
      label.append(document.createElement('br'), note);
    }
    const remove = document.createElement('button'); remove.type = 'button';
    remove.className = 'small-icon-button'; remove.textContent = '×'; remove.title = 'Remove relationship';
    remove.addEventListener('click', () => deleteWorldLink(link.id));
    row.append(label, remove); root.append(row);
  });
  if (!links.length) {
    const empty = document.createElement('p'); empty.className = 'hint';
    empty.textContent = 'Connect this entry to another part of the story.';
    root.append(empty);
  }
}
function selectWorldEntry(id) {
  const entry = worldEntries.find((item) => item.id === id);
  if (!entry) return;
  worldSelectedId = id;
  $('worldName').value = entry.title || '';
  $('worldSummary').value = entry.summary || '';
  $('worldDetails').value = entry.details || '';
  $('deleteWorldEntry').disabled = false;
  $('worldNotice').textContent = '';
  renderWorldEntries(); renderWorldRelationships();
}
function clearWorldEntryForm() {
  worldSelectedId = null; $('worldName').value = ''; $('worldSummary').value = ''; $('worldDetails').value = '';
  $('deleteWorldEntry').disabled = true; $('worldNotice').textContent = '';
  renderWorldEntries(); renderWorldRelationships();
}
async function openWorld() {
  if (!currentBook) return toast('Create a manuscript first.');
  try {
    await loadWorldEntries(); worldCategory = 'characters'; worldSelectedId = null;
    $('worldSearch').value = ''; clearWorldEntryForm(); $('worldDialog').showModal();
  } catch (error) { reportError(error); }
}
async function saveWorldEntry(event) {
  event.preventDefault();
  if (!currentBook) return;
  const title = $('worldName').value.trim();
  if (!title) return toast('Give this story entry a name.');
  const summary = $('worldSummary').value.trim(), details = $('worldDetails').value.trim();
  const id = worldSelectedId || randomId();
  try {
    if (worldCategory === 'characters') {
      const description = [summary, details].filter(Boolean).join('\n\n');
      const old = characters.find((character) => character.id === id);
      const savedCharacter = old
        ? await query(db('characters').update({ name: title, description }).eq('id', id).select().single())
        : await query(db('characters').insert({ id, book_id: currentBook.id, name: title, description }).select().single());
      characters = old ? characters.map((c) => c.id === id ? savedCharacter : c) : characters.concat(savedCharacter);
      await query(db('world_entries').upsert({
        id, book_id: currentBook.id, category: 'characters', title, summary, details,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' }));
      renderPovOptions();
    } else {
      const payload = { book_id: currentBook.id, category: worldCategory, title, summary, details,
        updated_at: new Date().toISOString() };
      if (worldSelectedId) await query(db('world_entries').update(payload).eq('id', worldSelectedId));
      else await query(db('world_entries').insert(payload));
    }
    await loadWorldEntries();
    const saved = worldEntries.find((entry) => entry.id === id) ||
      worldEntries.find((entry) => entry.category === worldCategory && entry.title === title);
    renderPovOptions();
    if (saved) selectWorldEntry(saved.id);
    toast('Story entry saved.');
  } catch (error) {
    reportError(error); $('worldNotice').textContent = friendlyError(error);
  }
}
async function deleteWorldEntry() {
  if (!worldSelectedId) return;
  const entry = worldEntries.find((item) => item.id === worldSelectedId);
  if (!entry) return;
  let dependent = [];
  if (entry.category === 'characters') {
    dependent = await query(db('scenes').select('id').eq('book_id', currentBook.id).eq('pov_character_id', entry.id));
  }
  const message = dependent.length
    ? 'This character is the point of view for ' + dependent.length + ' scene(s). Deleting it clears those assignments and removes its relationships.'
    : 'Delete “' + entry.title + '” and its story relationships?';
  if (!(await askConfirm('Delete story entry?', message, 'Delete entry', true))) return;
  try {
    if (dependent.length) {
      await query(db('scenes').update({ pov_character_id: null, updated_at: new Date().toISOString() })
        .eq('book_id', currentBook.id).eq('pov_character_id', entry.id));
    }
    await query(db('world_entries').delete().eq('id', entry.id));
    if (entry.category === 'characters') {
      await query(db('characters').delete().eq('id', entry.id));
      characters = characters.filter((c) => c.id !== entry.id);
      if (currentScene?.pov_character_id === entry.id) {
        currentScene.pov_character_id = null; $('povSelect').value = '';
        editGeneration += 1; dirty = true; storeDraft(); scheduleSave();
      }
    }
    worldSelectedId = null; await loadWorldEntries(); clearWorldEntryForm(); renderPovOptions();
    toast('Story entry deleted.');
  } catch (error) { reportError(error); }
}
async function createWorldLink(event) {
  event.preventDefault();
  if (!worldSelectedId) return toast('Save an entry before connecting it.');
  const to = $('linkTarget').value;
  const relation = $('linkRelation').value.trim() || 'related to';
  if (!to) return toast('Choose another story entry.');
  try {
    const created = await query(db('world_entry_links').insert({
      book_id: currentBook.id, from_entry_id: worldSelectedId, to_entry_id: to, relation
    }).select().single());
    worldLinks.push(created); $('linkTarget').value = ''; $('linkRelation').value = '';
    renderWorldRelationships(); toast('Relationship saved.');
  } catch (error) {
    if (/duplicate key|unique constraint/i.test(text(error.message))) toast('That relationship already exists.');
    else reportError(error);
  }
}
async function deleteWorldLink(id) {
  try {
    await query(db('world_entry_links').delete().eq('id', id));
    worldLinks = worldLinks.filter((link) => link.id !== id);
    renderWorldRelationships(); toast('Relationship removed.');
  } catch (error) { reportError(error); }
}

function getRevisionData(revision) {
  const content = revision.content;
  if (content && content.type === 'witches-desk-revision')
    return {
      document: normalizedDoc(content.document), title: content.title || currentScene?.title || 'Untitled Scene',
      pov_character_id: content.pov_character_id || null, label: content.label || 'Checkpoint'
    };
  return {
    document: normalizedDoc(content), title: currentScene?.title || 'Untitled Scene',
    pov_character_id: currentScene?.pov_character_id || null, label: 'Earlier version'
  };
}
async function createCheckpoint(label) {
  if (!currentScene) return;
  if (dirty && !(await saveNow())) return;
  await addRevision(currentScene, (label || '').trim() || 'Checkpoint',
    editor.getJSON(), $('sceneTitle').value.trim() || currentScene.title, $('povSelect').value || null);
  try { localStorage.setItem(autoCheckpointKey(currentScene.id), String(Date.now())); } catch {}
  toast('Revision checkpoint saved.');
}
async function openRevisions() {
  if (!currentScene) return;
  if (dirty && !(await saveNow())) return;
  $('revisionSceneName').textContent = currentScene.title || 'Untitled Scene';
  $('revisionList').replaceChildren();
  try {
    const revisions = await query(db('scene_revisions').select('*').eq('scene_id', currentScene.id)
      .order('created_at', { ascending: false }).limit(100));
    if (!revisions.length) {
      const empty = document.createElement('p'); empty.className = 'hint';
      empty.textContent = 'No checkpoints yet. Save one before a major revision or experiment.';
      $('revisionList').append(empty);
    }
    revisions.forEach((revision) => {
      const data = getRevisionData(revision), row = document.createElement('article');
      row.className = 'revision-row';
      const info = document.createElement('div'), name = document.createElement('strong'), date = document.createElement('small');
      name.textContent = data.label;
      date.textContent = dateLabel(revision.created_at, true) + ' · ' + wordCount(data.document).toLocaleString() + ' words';
      info.append(name, date);
      const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'button secondary';
      restore.textContent = 'Restore'; restore.addEventListener('click', () => restoreRevision(revision, data));
      row.append(info, restore); $('revisionList').append(row);
    });
    $('revisionsDialog').showModal();
  } catch (error) { reportError(error); }
}
async function restoreRevision(revision, data) {
  if (!(await askConfirm('Restore this version?', 'The current scene will be saved as a checkpoint before the selected version is restored.', 'Restore version', false))) return;
  if (dirty && !(await saveNow())) return;
  const scene = currentScene;
  try {
    await addRevision(scene, 'Before restoring ' + data.label, scene.content, scene.title, scene.pov_character_id);
    const result = await db('scenes').update({
      content: data.document, title: data.title, pov_character_id: data.pov_character_id,
      word_count: wordCount(data.document), updated_at: new Date().toISOString()
    }).eq('id', scene.id).eq('updated_at', scene.updated_at).select().maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
      const remote = await query(db('scenes').select('*').eq('id', scene.id).maybeSingle());
      if (remote) openConflict(remote);
      return;
    }
    Object.assign(scene, result.data); currentScene = scene;
    $('sceneTitle').value = scene.title; renderPovOptions(); setEditorDocument(scene.content);
    dirty = false; clearDraft(scene.id); setSaveState('Saved', 'saved');
    $('revisionsDialog').close(); renderScenes(); updateStats().catch(() => {});
    toast('Scene restored. The replaced version remains in history.');
  } catch (error) { reportError(error); }
}

function showInspector(name) {
  document.querySelectorAll('[data-inspector]').forEach((button) => {
    const active = button.dataset.inspector === name;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
  });
  $('sceneInspector').hidden = name !== 'scene';
  $('notesInspector').hidden = name !== 'notes';
  $('outlineInspector').hidden = name !== 'outline';
}

function buildSnippet(value, start, length) {
  const from = Math.max(0, start - 65), to = Math.min(value.length, start + length + 90);
  return (from ? '…' : '') + value.slice(from, to).replace(/\s+/g, ' ') + (to < value.length ? '…' : '');
}
async function searchManuscript() {
  const term = $('searchInput').value.trim(), root = $('searchResults');
  root.replaceChildren();
  if (!term) {
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = 'Type a word or phrase to search every scene in this manuscript.'; root.append(hint); return;
  }
  if (!currentBook) return;
  if (dirty && !(await saveNow())) return;
  $('searchAgainButton').disabled = true;
  const progress = document.createElement('p'); progress.className = 'hint'; progress.textContent = 'Searching the manuscript…'; root.append(progress);
  try {
    const [allScenes, allChapters] = await Promise.all([
      query(db('scenes').select('id,book_id,chapter_id,title,content,sort_order,word_count,updated_at').eq('book_id', currentBook.id)),
      query(db('chapters').select('id,title,sort_order').eq('book_id', currentBook.id))
    ]);
    const chapterById = new Map(allChapters.map((chapter) => [chapter.id, chapter]));
    const matchCase = $('matchCase').checked;
    const needle = matchCase ? term : term.toLocaleLowerCase();
    const found = [];
    (allScenes || []).forEach((scene) => {
      const body = documentText(scene.content), haystack = matchCase ? body : body.toLocaleLowerCase();
      let at = haystack.indexOf(needle);
      while (at >= 0 && found.length < 250) {
        found.push({ scene, chapter: chapterById.get(scene.chapter_id), body, at });
        at = haystack.indexOf(needle, at + Math.max(needle.length, 1));
      }
    });
    root.replaceChildren();
    if (!found.length) {
      const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = 'No matches found.'; root.append(empty);
    } else {
      const summary = document.createElement('p'); summary.className = 'search-summary';
      summary.textContent = found.length.toLocaleString() + (found.length === 250 ? '+ matches' : ' matches'); root.append(summary);
      found.forEach((match) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'search-result';
        const location = document.createElement('strong'), snippet = document.createElement('small');
        location.textContent = (match.chapter?.title || 'Chapter') + ' · ' + (match.scene.title || 'Scene');
        snippet.textContent = buildSnippet(match.body, match.at, term.length);
        button.append(location, snippet); button.addEventListener('click', () => openSearchResult(match)); root.append(button);
      });
    }
  } catch (error) {
    root.replaceChildren(); const message = document.createElement('p'); message.className = 'hint';
    message.textContent = friendlyError(error); root.append(message);
  } finally {
    $('searchAgainButton').disabled = false;
  }
}
async function openSearchResult(match) {
  if (dirty && !(await saveNow())) return;
  const allChapters = await query(db('chapters').select('*').eq('book_id', currentBook.id).order('sort_order'));
  chapters = allChapters;
  const chapter = chapters.find((item) => item.id === match.scene.chapter_id);
  if (!chapter) return;
  await loadChapter(chapter, match.scene.id);
  $('searchDialog').close();
  setTimeout(() => selectPhraseInEditor($('searchInput').value, $('matchCase').checked), 120);
}
function selectPhraseInEditor(phrase, caseSensitive) {
  const find = text(phrase); if (!find) return;
  const walker = document.createTreeWalker($('editor'), NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const source = node.nodeValue || '';
    const haystack = caseSensitive ? source : source.toLocaleLowerCase();
    const at = haystack.indexOf(caseSensitive ? find : find.toLocaleLowerCase());
    if (at < 0) continue;
    const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + find.length);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    editor.commands.focus(); return;
  }
}
function findTextMatches(needle, caseSensitive) {
  const result = [], target = caseSensitive ? needle : needle.toLocaleLowerCase();
  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const body = caseSensitive ? node.text : node.text.toLocaleLowerCase();
    let at = body.indexOf(target);
    while (at >= 0) {
      result.push({ from: position + at, to: position + at + needle.length });
      at = body.indexOf(target, at + Math.max(1, target.length));
    }
  });
  return result;
}
function replaceInScene(all) {
  if (!currentScene || !editor) return toast('Open a scene before replacing text.');
  const needle = $('searchInput').value, replacement = $('replaceInput').value;
  if (!needle) return toast('Enter a search phrase first.');
  const found = findTextMatches(needle, $('matchCase').checked);
  if (!found.length) return toast('No matches in the open scene.');
  const selection = all ? found : [found.find((item) => item.from >= editor.state.selection.to) || found[0]];
  let transaction = editor.state.tr;
  selection.slice().sort((a, b) => b.from - a.from).forEach((match) => {
    transaction = transaction.insertText(replacement, match.from, match.to);
  });
  editor.view.dispatch(transaction);
  toast(all ? selection.length + ' replacements made in this scene.' : 'Next match replaced in this scene.');
}
function showSearch() {
  if (!currentBook) return toast('Open a manuscript to search it.');
  $('searchDialog').showModal(); $('searchInput').focus();
  if ($('searchInput').value.trim()) searchManuscript();
}


async function loadManuscriptBundle() {
  if (!currentBook) return null;
  if (dirty && !(await saveNow())) return null;
  const results = await Promise.all([
    query(db('chapters').select('*').eq('book_id', currentBook.id).order('sort_order')),
    query(db('scenes').select('*').eq('book_id', currentBook.id)),
    query(db('characters').select('*').eq('book_id', currentBook.id)),
    query(db('notes').select('*').eq('book_id', currentBook.id)),
    query(db('world_entries').select('*').eq('book_id', currentBook.id)),
    query(db('world_entry_links').select('*').eq('book_id', currentBook.id)),
    query(db('scene_revisions').select('*').eq('book_id', currentBook.id))
  ]);
  const chapterRows = results[0] || [];
  const chapterOrder = new Map(chapterRows.map((chapter, index) => [chapter.id, index]));
  const sceneRows = (results[1] || []).sort((a, b) =>
    (chapterOrder.get(a.chapter_id) ?? 0) - (chapterOrder.get(b.chapter_id) ?? 0) ||
    Number(a.sort_order || 0) - Number(b.sort_order || 0)
  ).map((scene) => ({ ...scene, content: normalizedDoc(scene.content) }));
  return {
    format: 'witches-desk-backup',
    version: 1,
    exported_at: new Date().toISOString(),
    manuscript: {
      title: currentBook.title,
      description: currentBook.description || '',
      pov_mode: currentBook.pov_mode || 'single'
    },
    chapters: chapterRows,
    scenes: sceneRows,
    characters: results[2] || [],
    notes: results[3] || [],
    world_entries: results[4] || [],
    world_entry_links: results[5] || [],
    scene_revisions: results[6] || []
  };
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportBackup() {
  try {
    const bundle = await loadManuscriptBundle();
    if (!bundle) return;
    downloadBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' }),
      safeFilename(bundle.manuscript.title) + '-witches-desk-backup.json');
    toast('Manuscript backup downloaded.');
  } catch (error) { reportError(error); }
}
function marksToMarkdown(node) {
  if (!node) return '';
  if (node.type === 'hardBreak') return '  \n';
  if (node.type === 'text') {
    let result = text(node.text).replace(/\\/g, '\\\\').replace(/([*_[\]])/g, '\\$1');
    const tick = String.fromCharCode(96);
    (node.marks || []).forEach((mark) => {
      if (mark.type === 'bold') result = '**' + result + '**';
      else if (mark.type === 'italic') result = '*' + result + '*';
      else if (mark.type === 'strike') result = '~~' + result + '~~';
      else if (mark.type === 'underline') result = '<u>' + result + '</u>';
      else if (mark.type === 'code') result = tick + result + tick;
      else if (mark.type === 'link' && safeLinkUrl(mark.attrs?.href))
        result = '[' + result + '](' + mark.attrs.href + ')';
      else if (mark.type === 'highlight') result = '==' + result + '==';
    });
    return result;
  }
  return (node.content || []).map(marksToMarkdown).join('');
}
function documentMarkdown(content) {
  const doc = normalizedDoc(content);
  function render(node, depth) {
    if (!node) return '';
    const children = node.content || [];
    if (node.type === 'doc') return children.map((child) => render(child, depth)).filter(Boolean).join('\n\n');
    if (node.type === 'paragraph') return marksToMarkdown(node);
    if (node.type === 'heading')
      return '#'.repeat(Math.max(1, Math.min(6, Number(node.attrs?.level || 1)))) + ' ' + marksToMarkdown(node);
    if (node.type === 'blockquote')
      return children.map((child) => render(child, depth)).join('\n').split('\n').map((line) => '> ' + line).join('\n');
    if (node.type === 'bulletList') return children.map((item) => renderList(item, depth, false, 0)).join('\n');
    if (node.type === 'orderedList') return children.map((item, index) => renderList(item, depth, true, index + Number(node.attrs?.start || 1))).join('\n');
    if (node.type === 'horizontalRule') return '---';
    if (node.type === 'codeBlock') return '    ' + children.map(marksToMarkdown).join('');
    return children.map((child) => render(child, depth)).join('\n');
  }
  function renderList(item, depth, ordered, number) {
    const prefix = ordered ? String(number) + '. ' : '- ';
    return '  '.repeat(depth) + prefix + (item.content || []).map((child) => render(child, depth + 1)).join('\n');
  }
  return render(doc, 0);
}
function htmlManuscript(bundle) {
  const chaptersHTML = bundle.chapters.map((chapter) => {
    const scenesHTML = bundle.scenes.filter((scene) => scene.chapter_id === chapter.id).map((scene) => {
      const body = tiptap.generateHTML(normalizedDoc(scene.content), editorExtensions);
      const pov = bundle.characters.find((character) => character.id === scene.pov_character_id);
      return '<section class="scene"><h2>' + safeText(scene.title || 'Untitled Scene') + '</h2>' +
        (pov ? '<p class="pov">Point of view: ' + safeText(pov.name) + '</p>' : '') +
        '<div class="body">' + body + '</div></section>';
    }).join('');
    return '<section class="chapter"><h1>' + safeText(chapter.title || 'Untitled Chapter') + '</h1>' + scenesHTML + '</section>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + safeText(bundle.manuscript.title) +
    '</title><style>body{max-width:760px;margin:4rem auto;padding:0 2rem;color:#211d26;font:12pt/1.7 Georgia,serif}h1,h2{line-height:1.25}h1{margin-top:3rem}.chapter{break-before:page}.chapter:first-of-type{break-before:auto}.scene{margin:2rem 0}.pov{font-size:9pt;color:#666;font-style:italic}blockquote{margin:1em 2em;color:#555}@media print{body{margin:0 auto}}</style></head><body><header><h1>' +
    safeText(bundle.manuscript.title) + '</h1>' +
    (bundle.manuscript.description ? '<p>' + safeText(bundle.manuscript.description) + '</p>' : '') +
    '</header>' + chaptersHTML + '</body></html>';
}
function markdownManuscript(bundle) {
  const parts = ['# ' + bundle.manuscript.title];
  if (bundle.manuscript.description) parts.push(bundle.manuscript.description);
  bundle.chapters.forEach((chapter) => {
    parts.push('# ' + chapter.title);
    bundle.scenes.filter((scene) => scene.chapter_id === chapter.id).forEach((scene) =>
      parts.push('## ' + scene.title + '\n\n' + documentMarkdown(scene.content)));
  });
  return parts.join('\n\n') + '\n';
}
async function exportHTML() {
  try {
    const bundle = await loadManuscriptBundle();
    if (!bundle) return;
    downloadBlob(new Blob([htmlManuscript(bundle)], { type: 'text/html;charset=utf-8' }),
      safeFilename(bundle.manuscript.title) + '.html');
    toast('HTML manuscript exported.');
  } catch (error) { reportError(error); }
}
async function exportMarkdown() {
  try {
    const bundle = await loadManuscriptBundle();
    if (!bundle) return;
    downloadBlob(new Blob([markdownManuscript(bundle)], { type: 'text/markdown;charset=utf-8' }),
      safeFilename(bundle.manuscript.title) + '.md');
    toast('Markdown manuscript exported.');
  } catch (error) { reportError(error); }
}
async function printManuscript() {
  const printWindow = window.open('about:blank', '_blank');
  if (!printWindow) return toast('Allow popups to open the print view.', 'error');
  try {
    const bundle = await loadManuscriptBundle();
    if (!bundle) { printWindow.close(); return; }
    printWindow.document.open(); printWindow.document.write(htmlManuscript(bundle)); printWindow.document.close();
    printWindow.document.title = bundle.manuscript.title;
    setTimeout(() => { try { printWindow.focus(); printWindow.print(); } catch (error) { console.error(error); } }, 700);
  } catch (error) { printWindow.close(); reportError(error); }
}
function docxRuns(node, module) {
  if (!node) return [];
  if (node.type === 'text') {
    const markTypes = new Set((node.marks || []).map((mark) => mark.type));
    const link = (node.marks || []).find((mark) => mark.type === 'link')?.attrs?.href;
    const options = {
      text: node.text || '',
      bold: markTypes.has('bold'),
      italics: markTypes.has('italic'),
      strike: markTypes.has('strike'),
      underline: markTypes.has('underline') ? {} : undefined,
      highlight: markTypes.has('highlight') ? 'yellow' : undefined
    };
    if (link && safeLinkUrl(link)) options.link = { url: link };
    return [new module.TextRun(options)];
  }
  if (node.type === 'hardBreak') return [new module.TextRun({ break: 1 })];
  return (node.content || []).flatMap((child) => docxRuns(child, module));
}
function docxParagraphs(content, module) {
  const root = normalizedDoc(content), out = [];
  function push(node) {
    if (!node) return;
    if (node.type === 'paragraph') {
      const alignment = node.attrs?.textAlign === 'center' ? module.AlignmentType.CENTER
        : node.attrs?.textAlign === 'right' ? module.AlignmentType.RIGHT
          : node.attrs?.textAlign === 'justify' ? module.AlignmentType.JUSTIFIED : module.AlignmentType.LEFT;
      out.push(new module.Paragraph({ children: docxRuns(node, module), alignment, spacing: { after: 220, line: 340 } }));
    } else if (node.type === 'heading') {
      const level = Math.max(1, Math.min(3, Number(node.attrs?.level || 1)));
      out.push(new module.Paragraph({
        children: docxRuns(node, module),
        heading: module.HeadingLevel['HEADING_' + level],
        spacing: { before: 280, after: 140 }
      }));
    } else if (node.type === 'blockquote') {
      (node.content || []).forEach((child) =>
        out.push(new module.Paragraph({ children: docxRuns(child, module), indent: { left: 720, right: 360 }, spacing: { after: 180 } })));
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      const ordered = node.type === 'orderedList';
      let number = Number(node.attrs?.start || 1);
      (node.content || []).forEach((item) => {
        const runs = (item.content || []).flatMap((child) => docxRuns(child, module));
        out.push(new module.Paragraph({
          children: [new module.TextRun(ordered ? String(number++) + '. ' : '• '), ...runs],
          indent: { left: 720, hanging: 300 }, spacing: { after: 80 }
        }));
      });
    } else if (node.type === 'horizontalRule') {
      out.push(new module.Paragraph({ text: '────────────────────', spacing: { before: 120, after: 120 } }));
    } else if (node.type === 'codeBlock') {
      out.push(new module.Paragraph({ children: docxRuns(node, module), spacing: { after: 120 } }));
    } else {
      (node.content || []).forEach(push);
    }
  }
  (root.content || []).forEach(push);
  return out;
}
async function exportDocx() {
  try {
    const bundle = await loadManuscriptBundle();
    if (!bundle) return;
    toast('Preparing the Word document…');
    const module = await import('https://cdn.jsdelivr.net/npm/docx@9.15.3/+esm');
    const children = [
      new module.Paragraph({ text: bundle.manuscript.title, heading: module.HeadingLevel.TITLE })
    ];
    if (bundle.manuscript.description)
      children.push(new module.Paragraph({ text: bundle.manuscript.description, spacing: { after: 360 } }));
    bundle.chapters.forEach((chapter, index) => {
      children.push(new module.Paragraph({
        text: chapter.title,
        heading: module.HeadingLevel.HEADING_1,
        pageBreakBefore: index > 0
      }));
      bundle.scenes.filter((scene) => scene.chapter_id === chapter.id).forEach((scene) => {
        children.push(new module.Paragraph({ text: scene.title, heading: module.HeadingLevel.HEADING_2 }));
        const pov = bundle.characters.find((character) => character.id === scene.pov_character_id);
        if (pov) children.push(new module.Paragraph({ text: 'Point of view: ' + pov.name, italics: true }));
        children.push(...docxParagraphs(scene.content, module));
      });
    });
    const doc = new module.Document({
      creator: 'The Witch’s Desk', title: bundle.manuscript.title,
      description: bundle.manuscript.description || '',
      sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }]
    });
    downloadBlob(await module.Packer.toBlob(doc), safeFilename(bundle.manuscript.title) + '.docx');
    toast('Word document exported.');
  } catch (error) { reportError(error); }
}
function exportByType(type) {
  document.querySelectorAll('.menu-wrap[open]').forEach((menu) => menu.removeAttribute('open'));
  if (!currentBook) return toast('Open a manuscript first.');
  if (type === 'docx') return exportDocx();
  if (type === 'html') return exportHTML();
  if (type === 'markdown') return exportMarkdown();
  if (type === 'print') return printManuscript();
}
async function importBackup(file) {
  if (!file) return;
  if (!(await askConfirm('Restore a manuscript backup?', 'The backup will be restored as a new manuscript, leaving existing manuscripts unchanged.', 'Restore backup', false))) {
    $('backupFile').value = ''; return;
  }
  let createdBook = null;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== 'witches-desk-backup' || data.version !== 1 || !data.manuscript)
      throw new Error('This is not a supported Witch’s Desk backup.');
    createdBook = await query(db('books').insert({
      title: text(data.manuscript.title || 'Restored Manuscript').slice(0, 220) + ' (restored)',
      description: data.manuscript.description || '',
      pov_mode: data.manuscript.pov_mode === 'dual' ? 'dual' : 'single'
    }).select().single());
    const chapterIds = new Map(), sceneIds = new Map(), characterIds = new Map(), worldIds = new Map();

    for (const old of data.chapters || []) {
      const row = await query(db('chapters').insert({
        id: randomId(), book_id: createdBook.id, title: old.title || 'Untitled Chapter',
        sort_order: Number(old.sort_order || 0)
      }).select().single());
      chapterIds.set(old.id, row.id);
    }
    for (const old of data.characters || []) {
      const row = await query(db('characters').insert({
        id: randomId(), book_id: createdBook.id, name: old.name || 'Unnamed Character',
        description: old.description || '', sigil: old.sigil || null
      }).select().single());
      characterIds.set(old.id, row.id);
    }
    for (const old of data.world_entries || []) {
      let id = characterIds.get(old.id) || randomId();
      const category = CATEGORIES.some((item) => item[0] === old.category) ? old.category : 'lore';
      const row = await query(db('world_entries').insert({
        id, book_id: createdBook.id, category, title: old.title || 'Unnamed entry',
        summary: old.summary || '', details: old.details || ''
      }).select().single());
      worldIds.set(old.id, row.id);
      if (category === 'characters' && !characterIds.has(old.id)) {
        const character = await query(db('characters').insert({
          id, book_id: createdBook.id, name: row.title,
          description: [row.summary, row.details].filter(Boolean).join('\n\n')
        }).select().single());
        characterIds.set(old.id, character.id);
      }
    }
    for (const old of data.scenes || []) {
      const row = await query(db('scenes').insert({
        id: randomId(), book_id: createdBook.id, chapter_id: chapterIds.get(old.chapter_id),
        title: old.title || 'Untitled Scene', content: normalizedDoc(old.content),
        sort_order: Number(old.sort_order || 0), word_count: wordCount(old.content),
        pov_character_id: characterIds.get(old.pov_character_id) || null,
        updated_at: old.updated_at || new Date().toISOString()
      }).select().single());
      sceneIds.set(old.id, row.id);
    }
    for (const old of data.notes || []) {
      await query(db('notes').insert({
        book_id: createdBook.id, title: old.title || 'Untitled Note',
        body: old.body || '', category: old.category || 'general',
        updated_at: old.updated_at || new Date().toISOString()
      }));
    }
    for (const old of data.world_entry_links || []) {
      const from = worldIds.get(old.from_entry_id), to = worldIds.get(old.to_entry_id);
      if (from && to && from !== to) await query(db('world_entry_links').insert({
        book_id: createdBook.id, from_entry_id: from, to_entry_id: to,
        relation: old.relation || 'related to', notes: old.notes || ''
      }));
    }
    for (const old of data.scene_revisions || []) {
      const sceneId = sceneIds.get(old.scene_id);
      if (!sceneId) continue;
      let content = old.content || emptyDoc();
      if (content.type === 'witches-desk-revision') {
        content = { ...content, document: normalizedDoc(content.document),
          pov_character_id: characterIds.get(content.pov_character_id) || null };
      }
      await query(db('scene_revisions').insert({
        book_id: createdBook.id, scene_id: sceneId, content,
        created_at: old.created_at || new Date().toISOString()
      }));
    }
    currentBook = createdBook;
    await loadBooks(createdBook.id);
    toast('Backup restored as a new manuscript.');
  } catch (error) {
    if (createdBook) {
      try { await query(db('books').delete().eq('id', createdBook.id)); }
      catch (cleanupError) { console.error('Could not remove the incomplete restore.', cleanupError); }
    }
    reportError(error);
  } finally {
    $('backupFile').value = '';
  }
}

async function bookAction(action) {
  $('bookMenu').hidden = true;
  if (!currentBook) return;
  if (action === 'rename') return renameRecord('book', currentBook.id);
  if (action === 'delete') return deleteRecord('book', currentBook.id);
  if (action === 'description') {
    const value = await askText('Manuscript description', 'Short description', currentBook.description || '', true, false);
    if (value === null) return;
    try {
      const saved = await query(db('books').update({ description: value.trim(), updated_at: new Date().toISOString() })
        .eq('id', currentBook.id).select().single());
      Object.assign(currentBook, saved); renderBookSelect(); toast('Description saved.');
    } catch (error) { reportError(error); }
  }
}


function applyPreferences() {
  let pref = {};
  try { pref = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch {}
  const font = ['serif', 'sans', 'mono'].includes(pref.font) ? pref.font : 'serif';
  const size = [17, 18, 20, 22].includes(Number(pref.size)) ? Number(pref.size) : 18;
  document.documentElement.dataset.font = font;
  document.documentElement.style.setProperty('--editor-font-size', size + 'px');
  $('fontChoice').value = font; $('fontSizeChoice').value = String(size);
}
function savePreferences() {
  const value = { font: $('fontChoice').value, size: Number($('fontSizeChoice').value) };
  document.documentElement.dataset.font = value.font;
  document.documentElement.style.setProperty('--editor-font-size', value.size + 'px');
  try { localStorage.setItem(PREF_KEY, JSON.stringify(value)); } catch {}
}
function focusMode(enabled) {
  document.body.classList.toggle('focus-mode', enabled);
  $('focusButton').textContent = enabled ? 'Leave focus mode' : 'Enter focus mode';
  if (enabled) editor?.commands.focus();
}
function runToolbarCommand(command) {
  if (!editor || !currentScene) return;
  const chain = editor.chain().focus();
  const actions = {
    undo: () => chain.undo().run(),
    redo: () => chain.redo().run(),
    bold: () => chain.toggleBold().run(),
    italic: () => chain.toggleItalic().run(),
    underline: () => chain.toggleUnderline().run(),
    strike: () => chain.toggleStrike().run(),
    highlight: () => chain.toggleHighlight().run(),
    bulletList: () => chain.toggleBulletList().run(),
    orderedList: () => chain.toggleOrderedList().run(),
    blockquote: () => chain.toggleBlockquote().run(),
    alignLeft: () => chain.setTextAlign('left').run(),
    alignCenter: () => chain.setTextAlign('center').run(),
    alignRight: () => chain.setTextAlign('right').run()
  };
  actions[command]?.(); updateToolbarState();
}
function changeBlockStyle() {
  if (!editor || !currentScene) return;
  const value = $('blockStyle').value;
  if (value === 'paragraph') editor.chain().focus().setParagraph().run();
  else editor.chain().focus().toggleHeading({ level: Number(value.replace('heading', '')) }).run();
}
function linkDialog() {
  if (!editor || !currentScene) return;
  $('linkUrl').value = editor.getAttributes('link')?.href || '';
  $('linkDialog').showModal(); $('linkUrl').focus();
}
function applyLink(event) {
  event.preventDefault();
  const value = $('linkUrl').value.trim();
  if (!safeLinkUrl(value)) return toast('Use a secure web link, an email address, or a phone link.', 'error');
  editor.chain().focus().setLink({ href: value }).run();
  $('linkDialog').close();
}
function openConfigSettings() {
  const config = getConfig();
  $('projectUrl').value = config.url || '';
  $('publishableKey').value = config.key || '';
  $('cancelSettings').hidden = false;
  showView('setup');
}
async function signOut() {
  if (dirty) {
    const accepted = await askConfirm('Sign out with unsynced writing?',
      'A local recovery draft will remain in this browser, but it has not reached the cloud. Save now if possible.',
      'Sign out', false);
    if (!accepted) return;
    await saveNow();
  }
  try { await client.auth.signOut({ scope: 'local' }); }
  catch (error) { reportError(error); }
}
async function openDesk(user) {
  if (!user || !user.id) return;
  if (lastLoadedUserId === user.id && !$('desk').hidden) return;
  activeUser = user; lastLoadedUserId = user.id;
  $('accountLabel').textContent = user.email || 'Signed in';
  makeEditor(); showView('desk');
  setConnectionState(navigator.onLine, navigator.onLine ? 'Connected' : 'Offline');
  if (bootError) toast('The writing editor could not load. Check the connection and reload.', 'error');
  try { await loadBooks(); } catch (error) { reportError(error); }
}
function configureClient() {
  const config = getConfig();
  if (!config || !config.url || !config.key) { showView('setup'); return false; }
  client = createClient(config.url, config.key, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    db: { schema: SCHEMA },
    global: { headers: { 'X-Client-Info': 'witches-desk/1.0' } }
  });
  return true;
}
async function authStart() {
  if (!configureClient()) return;
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      activeUser = null; lastLoadedUserId = null; currentBook = null; currentChapter = null; currentScene = null;
      dirty = false; if (editor) editor.setEditable(false); showView('auth');
      setConnectionState(navigator.onLine, navigator.onLine ? 'Connected' : 'Offline');
      return;
    }
    if (event === 'PASSWORD_RECOVERY') {
      if (session?.user) {
        setTimeout(() => openDesk(session.user).then(() => $('passwordDialog').showModal()).catch(reportError), 0);
      }
      return;
    }
    if (session?.user) setTimeout(() => openDesk(session.user).catch(reportError), 0);
  });
  try {
    const stored = await client.auth.getSession();
    if (stored.error) throw stored.error;
    if (!stored.data.session) { showView('auth'); return; }
    const verified = await client.auth.getUser();
    if (verified.error) throw verified.error;
    if (verified.data.user) await openDesk(verified.data.user);
    else showView('auth');
  } catch (error) {
    console.warn('No current verified session.', error);
    showView('auth');
  }
}
async function handleSignIn(event) {
  event.preventDefault(); $('authMessage').textContent = '';
  try {
    const result = await client.auth.signInWithPassword({
      email: $('email').value.trim(), password: $('password').value
    });
    if (result.error) throw result.error;
    $('password').value = '';
    if (result.data.user) await openDesk(result.data.user);
  } catch (error) { $('authMessage').textContent = friendlyError(error); }
}
async function sendPasswordReset() {
  const email = $('email').value.trim();
  if (!email) {
    $('authMessage').textContent = 'Enter your account email first.'; $('email').focus(); return;
  }
  try {
    const result = await client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href.split('#')[0]
    });
    if (result.error) throw result.error;
    $('authMessage').textContent = 'If that address belongs to an account, a password reset link has been sent.';
  } catch (error) { $('authMessage').textContent = friendlyError(error); }
}
async function updatePassword(event) {
  event.preventDefault();
  const value = $('newPassword').value;
  if (value.length < 8) { $('passwordUpdateMessage').textContent = 'Use at least eight characters.'; return; }
  if (value !== $('confirmNewPassword').value) {
    $('passwordUpdateMessage').textContent = 'The two passwords do not match.'; return;
  }
  try {
    const result = await client.auth.updateUser({ password: value });
    if (result.error) throw result.error;
    $('passwordDialog').close(); $('newPassword').value = ''; $('confirmNewPassword').value = '';
    toast('Password updated.');
  } catch (error) { $('passwordUpdateMessage').textContent = friendlyError(error); }
}
function wireEvents() {
  $('configForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const url = $('projectUrl').value.trim().replace(/\/+$/, '');
    const key = $('publishableKey').value.trim();
    if (!/^https:\/\/[^/]+\.supabase\.co$/.test(url) || !key || /service_role|secret/i.test(key))
      return toast('Enter the project URL and its public publishable key.', 'error');
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, key }));
      window.location.reload();
    } catch (error) { reportError(error); }
  });
  $('cancelSettings').addEventListener('click', () => window.location.reload());
  $('signInForm').addEventListener('submit', handleSignIn);
  $('resetPassword').addEventListener('click', sendPasswordReset);
  $('passwordUpdateForm').addEventListener('submit', updatePassword);
  $('signout').addEventListener('click', signOut);

  $('bookSelect').addEventListener('change', () => switchBook($('bookSelect').value).catch(reportError));
  $('newBookButton').addEventListener('click', createBook);
  $('emptyCreateButton').addEventListener('click', createBook);
  $('newChapterButton').addEventListener('click', createChapter);
  $('newSceneButton').addEventListener('click', createScene);
  $('bookOptions').addEventListener('click', () => { $('bookMenu').hidden = !$('bookMenu').hidden; });
  $('bookMenu').addEventListener('click', (event) => {
    const button = event.target.closest('[data-book-action]');
    if (button) bookAction(button.dataset.bookAction);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.book-picker')) $('bookMenu').hidden = true;
  });
  $('chapterList').addEventListener('click', (event) => {
    const action = event.target.closest('[data-nav-action]');
    const open = event.target.closest('[data-nav-open="chapter"]');
    if (action) handleNavAction(action);
    else if (open) switchChapter(open.dataset.id).catch(reportError);
  });
  $('sceneList').addEventListener('click', (event) => {
    const action = event.target.closest('[data-nav-action]');
    const open = event.target.closest('[data-nav-open="scene"]');
    if (action) handleNavAction(action);
    else if (open) switchScene(open.dataset.id).catch(reportError);
  });
  $('sceneTitle').addEventListener('input', () => {
    if (!currentScene || loadingEditor) return;
    $('sceneCrumb').textContent = $('sceneTitle').value || 'Untitled Scene';
    editGeneration += 1; dirty = true; storeDraft(); setSaveState('Unsaved changes', 'dirty'); scheduleSave();
  });
  $('saveButton').addEventListener('click', () => saveNow().then((ok) => {
    if (ok) toast('Scene saved.');
  }).catch(reportError));
  $('povSelect').addEventListener('change', () => {
    if (!currentScene) return;
    editGeneration += 1; dirty = true; storeDraft(); updateCounts();
    setSaveState('Unsaved changes', 'dirty'); scheduleSave();
  });
  $('povModeSelect').addEventListener('change', changePovMode);
  $('checkpointButton').addEventListener('click', async () => {
    const label = await askText('Save a revision checkpoint', 'Checkpoint name', 'Before a major change');
    if (label !== null) {
      try { await createCheckpoint(label); } catch (error) { reportError(error); }
    }
  });
  $('revisionsButton').addEventListener('click', openRevisions);
  $('revisionSaveButton').addEventListener('click', async () => {
    const label = await askText('Save a revision checkpoint', 'Checkpoint name', 'A moment worth keeping');
    if (label !== null) {
      try { await createCheckpoint(label); await openRevisions(); } catch (error) { reportError(error); }
    }
  });
  $('closeRevisions').addEventListener('click', () => $('revisionsDialog').close());
  $('closeRevisions2').addEventListener('click', () => $('revisionsDialog').close());

  document.querySelectorAll('[data-command]').forEach((button) =>
    button.addEventListener('click', () => runToolbarCommand(button.dataset.command)));
  $('blockStyle').addEventListener('change', changeBlockStyle);
  $('linkButton').addEventListener('click', () => {
    if (!editor || !currentScene) return;
    $('linkUrl').value = editor.getAttributes('link')?.href || '';
    $('linkDialog').showModal(); $('linkUrl').focus();
  });
  $('linkForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = $('linkUrl').value.trim();
    if (!safeLinkUrl(value)) return toast('Use a secure web link, an email address, or a phone link.', 'error');
    editor.chain().focus().setLink({ href: value }).run(); $('linkDialog').close();
  });
  $('removeLinkButton').addEventListener('click', () => {
    editor?.chain().focus().unsetLink().run(); $('linkDialog').close();
  });
  $('clearFormatButton').addEventListener('click', () => {
    if (editor && currentScene) editor.chain().focus().unsetAllMarks().clearNodes().setParagraph().run();
  });

  $('newNoteButton').addEventListener('click', newNote);
  $('saveNoteButton').addEventListener('click', saveNote);
  $('deleteNoteButton').addEventListener('click', deleteNote);
  document.querySelectorAll('[data-inspector]').forEach((button) =>
    button.addEventListener('click', () => showInspector(button.dataset.inspector)));

  $('openWorldButton').addEventListener('click', openWorld);
  $('closeWorld').addEventListener('click', () => $('worldDialog').close());
  document.querySelectorAll('[data-world-cat]').forEach((button) => button.addEventListener('click', () => {
    worldCategory = button.dataset.worldCat; worldSelectedId = null;
    clearWorldEntryForm(); renderWorldEntries();
  }));
  $('worldSearch').addEventListener('input', renderWorldEntries);
  $('newWorldEntry').addEventListener('click', clearWorldEntryForm);
  $('worldEntryForm').addEventListener('submit', saveWorldEntry);
  $('deleteWorldEntry').addEventListener('click', deleteWorldEntry);
  $('linkEntryForm').addEventListener('submit', createWorldLink);

  $('searchButton').addEventListener('click', showSearch);
  $('searchAgainButton').addEventListener('click', searchManuscript);
  $('searchInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); searchManuscript(); }
  });
  $('replaceNextButton').addEventListener('click', () => replaceInScene(false));
  $('replaceAllButton').addEventListener('click', () => replaceInScene(true));

  document.querySelectorAll('[data-export]').forEach((button) =>
    button.addEventListener('click', () => exportByType(button.dataset.export)));
  $('backupButton').addEventListener('click', exportBackup);
  $('importButton').addEventListener('click', () => {
    $('backupFile').value = ''; $('backupFile').click();
    document.querySelectorAll('.menu-wrap[open]').forEach((menu) => menu.removeAttribute('open'));
  });
  $('backupFile').addEventListener('change', () => importBackup($('backupFile').files?.[0]));
  $('fontChoice').addEventListener('change', savePreferences);
  $('fontSizeChoice').addEventListener('change', savePreferences);
  $('focusButton').addEventListener('click', () => focusMode(!document.body.classList.contains('focus-mode')));
  $('settingsButton').addEventListener('click', openConfigSettings);
  $('useRemoteButton').addEventListener('click', () => resolveConflict(true));
  $('keepLocalButton').addEventListener('click', () => resolveConflict(false));
  $('conflictDialog').addEventListener('cancel', (event) => event.preventDefault());

  window.addEventListener('online', () => {
    setConnectionState(true, 'Connected');
    if (dirty) saveNow().catch(reportError);
  });
  window.addEventListener('offline', () => {
    setConnectionState(false, 'Offline');
    if (dirty) setSaveState('Offline draft', 'offline');
  });
  window.addEventListener('focus', refreshCloudScene);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCloudScene(); });
  window.setInterval(refreshCloudScene, 25000);
  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    storeDraft(); event.preventDefault(); event.returnValue = '';
  });
  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveNow().then((ok) => { if (ok) toast('Scene saved.'); }).catch(reportError);
    } else if (mod && event.key.toLowerCase() === 'f' && !$('desk').hidden) {
      event.preventDefault(); showSearch();
    } else if (event.key === 'Escape' && document.body.classList.contains('focus-mode')) {
      focusMode(false);
    }
  });
}
async function start() {
  wireEvents(); applyPreferences();
  setConnectionState(navigator.onLine, navigator.onLine ? 'Connecting' : 'Offline');
  if (!getConfig()) { showView('setup'); return; }
  await loadEditorLibraries();
  if (bootError) $('authMessage').textContent = 'The text editor could not be downloaded. Check your connection and reload.';
  await authStart();
}
start().catch((error) => {
  reportError(error); $('authMessage').textContent = friendlyError(error); showView('auth');
});

