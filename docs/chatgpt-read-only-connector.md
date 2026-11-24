# ChatGPT read-only connection

The Witch’s Desk can share a temporary, read-only connection with ChatGPT. Jess starts it by choosing **Ask ChatGPT** in the Desk. The Desk creates a random 256-bit capability that expires after 30 minutes. The Edge Function stores only its SHA-256 hash and binds the grant to the Desk account authenticated at the time of handoff. The raw capability is never stored in browser storage.

The handoff contains only the request ID and capability; it does not include manuscript content. ChatGPT uses those values in its reader tool calls. The server verifies the grant on every call, then makes fixed read-only queries constrained to that grant’s `owner_id`. It does not accept write actions. The legacy OAuth bearer-token path remains available for compatibility with older installations.

## Reader tools

- `list_manuscripts` returns titles and brief metadata.
- `get_manuscript_outline` returns chapter and scene titles and IDs.
- `read_chapter` returns one selected chapter’s scenes, capped at 50,000 characters per request.
- `read_scene` returns one selected scene, capped at 50,000 characters.
- `list_characters`, `list_notes`, `list_worldbuilding`, and `list_world_entry_links` return only requested planning records.

The connector does not save, edit, restore, or delete manuscript data. Text is sent to ChatGPT only when a user asks it to retrieve that material. The connector does not send writing to a dictionary or other lookup service.

## Database and function setup

Apply `supabase/migrations/20261118000000_witches_desk_reader_grants.sql` before deploying the updated `witches-desk-reader` Edge Function. The migration creates a private grants table with RLS enabled and access restricted to `service_role`. The Edge Function uses the platform-provided `SUPABASE_SERVICE_ROLE_KEY` only on the server, for grant validation and owner-filtered GET requests. Never place that key in the Desk app, plugin package, or browser configuration.

The function also validates the Desk session through Supabase Auth before creating a grant. It continues to support the legacy OAuth path for existing clients. No Supabase OAuth setting, signing key, provider, or existing row-level-security policy needs to be changed for this handoff.

## Make the plugin searchable for Jess

The plugin currently uses private, invited-user access. That does not put it in Jess’s plugin search. In the plugin’s **Share plugin** settings, change **Who has access** to **Visible in the Black Stag workspace directory**. Workspace admins must allow **Publish plugins to workspace** for the plugin owner’s role. This makes the plugin discoverable to eligible Black Stag workspace members; it does not publish it to the public directory. Members still need to install it, and each handoff remains bound to the Desk account that created it.

## Source files

- `app.js`, `index.html`, and `styles.css` add the desktop and mobile handoff control without changing autosave or draft recovery.
- `supabase/functions/witches-desk-reader/index.ts` implements grants and read-only tools.
- `supabase/migrations/20261118000000_witches_desk_reader_grants.sql` creates the isolated grant table.
- `plugin/witches-desk-reader/` contains the ChatGPT tool package and reader instructions.
