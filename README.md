# The Witch's Desk

Private, manuscript-first writing workspace. Initial build uses a neutral system UI; themed design comes after functionality.

## Architecture
- Static HTML/CSS/JavaScript frontend
- Supabase Auth + PostgreSQL
- Isolated `witches_desk` schema in the existing Quest Board project
- Per-user RLS on all six writing tables
- Chapter/scene editor, autosave, local recovery draft, POV selection, character notes, manual revision checkpoints

## Setup
1. In Supabase Dashboard > Project Settings > API > Exposed schemas, add `witches_desk` **without removing existing schemas**.
2. Deploy these static files (e.g. GitHub Pages). Do not put a service-role key in the browser.
3. On first launch, enter the project URL and **publishable** client key. These are stored in this browser's localStorage.
4. Sign in with a Supabase Auth user. If email confirmation is enabled, confirm the email before signing in.

## Current limits
- This is an initial functional editor, **not** a Microsoft Word replacement.
- Rich text uses native contenteditable / execCommand for the first iteration. Replace with a robust structured editor (e.g. Tiptap) before production manuscript writing.
- Export currently saves the selected scene as HTML, not DOCX/PDF/EPUB.
- Revisions are manual snapshots; revision restore UI is not implemented.
- Offline recovery is local draft protection, not a full offline sync queue.
- Character and note editing are basic; scene reorder, manuscript-wide search, backup and accessibility QA remain future work.
- Private schemas and RLS protect database rows, but the app still shares a Supabase project/Auth configuration with Quest Board. Test RLS with separate accounts before real manuscripts are stored.

## Security
Do not publish secret keys. Schema access and ownership policies must be verified with real signed-in sessions. Do not modify existing Quest Board functions or tables without a separate audit.
