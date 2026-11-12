# The Witch’s Desk

A private, manuscript-first writing room for Jess. The app is a static HTML/CSS/JavaScript project and uses the existing Quest Board Supabase project without reading or changing Quest Board tables.

## What works

- Password sign-in for an existing Supabase Auth account; there is no public account-creation control.
- Manuscripts, chapter and scene creation, rename, deletion, and reordering.
- Rich text editing with paragraphs, three heading levels, bold, italic, underline, strikethrough, highlight, lists, block quotes, links, alignment, undo and redo.
- Word and character counts, scene point of view, single or dual POV mode, heading outline, and manuscript-wide counts.
- Debounced cloud autosave, local recovery drafts, retry after reconnect, and conflict detection when a newer cloud version exists.
- Search across a manuscript and replace text in the open scene.
- Writer’s notes and a linked story archive for characters, settings, items, plotlines, and lore.
- Named revision checkpoints, automatic checkpoints during longer writing sessions, and restore.
- Export to DOCX, HTML, Markdown, and browser print (including Save as PDF).
- Download and restore a complete manuscript backup as JSON. Restore creates a new manuscript and leaves the current one alone.
- Focus mode, typeface and text-size preferences, password reset, and responsive desktop/mobile layouts.

## Architecture and data

- Tiptap 3.31.3 stores editor content as structured JSON in witches_desk.scenes.content.
- Supabase JS 2.57.0 handles authentication and data access. docx 9.15.3 loads only when exporting a Word file.
- CDN package URLs are version-pinned. The app needs a network connection to load its editor and export dependencies.
- The witches_desk schema is separate from public. It contains books, chapters, scenes, characters, notes, scene_revisions, world_entries, and world_entry_links.
- Every writing table has row-level security enabled. The owner policies use the authenticated user ID; child rows also use foreign keys scoped to the owning manuscript.
- Characters live in the POV table and are mirrored into world entries with the same UUID so scenes and story relationships can refer to the same person.
- The current Supabase project URL and publishable key are public client configuration values. No secret or service-role key belongs in this app.
- The current Quest Board project already contains the Witch’s Desk migrations and tables. The app does not modify Quest Board tables, functions, or authentication settings.

## Setup

1. In Supabase Project Settings → API → Exposed schemas, keep witches_desk exposed alongside any existing schemas. Do not remove existing entries.
2. Deploy index.html, styles.css, and app.js (for example, with GitHub Pages).
3. Open the site and sign in with the existing account. If the schema is unavailable, check the exposed-schema setting and the Supabase Data API grants.
4. If the account needs a new password, use “Send a password reset email” on the sign-in page.

## Writing safety and limits

- Cloud autosave is per scene. While a scene is open, the app checks for a newer cloud version on tab focus and periodically. If two devices edit the same scene, it keeps the local draft and asks which copy to keep.
- When offline, the current scene is protected as a local browser draft. This is recovery protection, not a full offline queue. Reconnect to sync it.
- Automatic revision checkpoints are created no more than once per 15 minutes per scene when a save occurs and the scene has at least 30 words. Use a named checkpoint before a major rewrite.
- Browser print opens the browser’s print dialog; choose “Save as PDF” there. DOCX export preserves common writing styles; complex page layout is outside this editor’s scope.
- Simultaneous collaborative editing, manuscript import from DOCX, EPUB export, and image embedding are not included.
- Because authentication is shared with the existing Supabase project, keep account access limited to the intended writing user. RLS prevents one user from reading another user’s manuscripts.

