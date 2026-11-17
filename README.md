# The Witch's Desk

A private, manuscript-first writing and story-development workspace built for long-form fiction.

## Current v1 feature set

### Writing
- Manuscripts → chapters → scenes
- Autosave with local crash/offline draft recovery
- Scene title, word count, manuscript word count, and POV assignment
- Undo/redo, bold, italic, underline, strikethrough, lists, headings, blockquotes, and alignment
- Scene-level find and replace
- Word-level thesaurus with definitions, up to 1,000 ranked synonym results (shown in batches), antonyms, related words, and a Wiktionary historical-synonym section
- Keyboard save shortcut
- Chapter and scene reordering
- Rename/delete controls with destructive-action confirmation

### Story development
- Persistent characters
- Story Grimoire with dedicated records for Settings, Items, Plotlines, and Lore
- Grimoire filtering
- General manuscript notes
- Manuscript-wide search across scenes, chapters, notes, characters, and Grimoire entries

### Manuscript protection
- Supabase authentication with persistent sessions
- Isolated `witches_desk` PostgreSQL schema
- Per-user Row Level Security on all writing/worldbuilding tables
- Manual scene revision checkpoints
- Revision history with safe restore (the current version is checkpointed before restoration)
- Browser-local recovery drafts
- Complete JSON project backup
- Unsaved-change navigation warning

### Export
- Current scene as HTML or plain text
- Full manuscript as HTML or plain text
- Print-ready manuscript view for browser Print / Save PDF
- Complete JSON backup including manuscript structure, worldbuilding, notes, characters, and revisions

## Architecture
- Static HTML/CSS/JavaScript frontend deployed with GitHub Pages
- Supabase Auth + PostgreSQL
- Publishable browser key only; no service-role or secret key is shipped to the client
- Dedicated `witches_desk.world_entries` data model for worldbuilding instead of encoding Grimoire content into notes

## Security
All Witch's Desk tables use RLS and owner-scoped policies for authenticated users. The app intentionally shares the existing Quest Board Supabase project while keeping writing data in its own schema.

Do not place secret keys, service-role keys, database passwords, or private credentials in frontend files.

### Synonym lookup data flow
The thesaurus sends only the selected word to Datamuse for standard lookup, or to the Wiktionary API for the Historical section. It does not send a sentence, surrounding text, scene, manuscript, user ID, or Supabase data. Historical synonym entries are shown with Wiktionary labels when available, including era or usage labels; the app does not infer an exact Victorian or medieval date when the source does not state one. Wiktionary content is linked and attributed under its CC BY-SA license. Datamuse says its temporary query logs are discarded at the end of the day. API keys will be required starting February 1, 2027; before then, move Datamuse requests behind a secret-backed endpoint if the feature is to remain available. Never put an API key in this browser app.

## Deliberate v1 boundaries
The application is now a complete practical writing environment, but it is not a literal Microsoft Word clone. The editor remains browser-native `contenteditable` rather than a structured editor engine such as Tiptap/ProseMirror. DOCX and EPUB are not generated natively; PDF is provided through the browser's print/PDF pipeline. These are appropriate future upgrades if Jess eventually needs publisher-facing interchange formats beyond the current HTML/TXT/PDF/JSON workflow.
