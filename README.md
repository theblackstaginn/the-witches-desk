# The Witch's Desk

A private, manuscript-first writing and story-development workspace built for long-form fiction.

## Current v1 feature set

### Writing
- Manuscripts → chapters → scenes
- Autosave with local crash/offline draft recovery
- Scene title, word count, manuscript word count, and POV assignment
- Undo/redo, bold, italic, underline, strikethrough, lists, headings, blockquotes, and alignment
- Scene-level find and replace
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

## Deliberate v1 boundaries
The application is now a complete practical writing environment, but it is not a literal Microsoft Word clone. The editor remains browser-native `contenteditable` rather than a structured editor engine such as Tiptap/ProseMirror. DOCX and EPUB are not generated natively; PDF is provided through the browser's print/PDF pipeline. These are appropriate future upgrades if Jess eventually needs publisher-facing interchange formats beyond the current HTML/TXT/PDF/JSON workflow.


## Desk presentation groundwork

The full-width title and formatting bars sit against the viewport edges. Manuscripts
and Details buttons collapse the edge rails without changing the selected scene.
On small screens they open as one-at-a-time drawers; Escape closes them and returns
focus to their button. The page scrolls independently beneath the controls and
keeps 18px body type. The editor, autosave, database, revision and export logic in
app.js is unchanged.

### Artwork slots

The final leather panels, leather buttons and writer's-view background have not
been generated. Set these CSS custom properties in styles.css when approved files
are ready (leather and desk slots currently default to none):

- --desk-image: full-scene background
- --leather-panel-image: rails and top bars
- --leather-button-image: shared button artwork
- --parchment-light-image: original Parchment Light Vol. 1 sheet

The manuscript uses assets/parchment-light-vol-1.jpg, the original
Parchment_Light_Vol_1_01.jpg supplied by the owner by email on November 12, 2026.
The original JPEG is preserved without alteration. The editor scales the sheet
to page width and repeats vertically for long scenes, with a warm ivory fallback
if unavailable. The background is CSS only: it is never stored in manuscript HTML
or included in manuscript exports. Future replacement sheets can use the same
custom property. Final leather and desk image assets remain deferred.

### Ambient scene

smoke.js draws one partly cropped incense stick and a bound sage bundle as
procedural placeholders, plus separate narrow incense and broader sage plumes.
Advected particles use layered smooth noise, randomized lifetimes and irregular
ember brightness. The canvas stays at the far left behind all controls and never
receives pointer or accessibility focus. These objects can be art-directed further
when the final background is supplied.

The simulation caps particles at 260, pixel density at 1.5 and rendering at 30fps.
It stops while the document is hidden or the workspace is signed out. Reduced
motion and phone-width views get still objects/embers with no smoke animation.
Media preference changes, resize, page suspension and return are handled live.

### Validation

Run `npm install`, `npm run check`, and `npm test` (Microsoft Edge installed).
Browser checks serve the local site with an intercepted Supabase client and sample
records; no real account or manuscript is read or changed. They cover viewport
widths 1440, 1024, 760, 390 and 320, drawer focus/Escape, autosave, dialogs and
live reduced-motion switching. Screenshots go to the system temporary folder.
