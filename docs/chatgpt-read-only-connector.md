# ChatGPT read-only connection

This connection is a separate, optional interface to the Witch’s Desk. The Desk app itself is unchanged. Its MCP service exposes only read tools and uses the signed-in Supabase user’s access token for every query; the existing `witches_desk` row-level security policies decide which rows can be returned. The function makes `GET` requests only and has no write, restore, or delete tools.

## Contents

- `oauth-consent.html` is the Supabase OAuth consent and sign-in page. It does not alter the Desk editor or its saved drafts.
- `supabase/functions/witches-desk-reader/index.ts` is the read-only MCP endpoint. It validates the bearer token with Supabase Auth and queries only the approved `witches_desk` tables.
- `plugin/witches-desk-reader/` is the private ChatGPT plugin package.

The plugin can list manuscript metadata and outlines, read one selected scene, and list notes, characters, and worldbuilding. It cannot write manuscript or planning data. Scene text is returned to ChatGPT only when Jess asks for that scene. The connector does not send writing to a dictionary or search provider.

## Supabase OAuth setup required

Supabase OAuth Server is a separate project setting and must be enabled by the project owner before ChatGPT can connect. The consent page needs to be published with the Desk before setting the authorization path.

1. In Supabase, open **Authentication → OAuth Server** and enable OAuth 2.1.
2. Keep the existing Desk Site URL. Set the authorization path to `/oauth-consent.html` so sign-in and consent use the Desk’s own published page.
3. Enable dynamic client registration for ChatGPT’s OAuth client. Supabase warns that this permits MCP clients to register; the consent page therefore displays the requesting client name, redirect URI, and scopes, and requires a user decision. Jess should approve only a request that is clearly the Witch’s Desk Reader in ChatGPT.
4. Add the published page to the Auth redirect allow list if Supabase requests it. Do not change the project’s signing keys, existing sign-in providers, or row-level security policies for this connector.
5. Publish the Edge Function `witches-desk-reader` with JWT gateway verification disabled. The function performs its own Supabase Auth user check and returns `401` otherwise. It uses the project’s publishable/anon key and the caller’s bearer token; it never uses the service-role key.
6. Install the private plugin in Jess’s ChatGPT account and complete its OAuth connection by signing into her Desk account and approving the read-only request.

The Edge Function requires the platform-provided `SUPABASE_URL` and either `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY` runtime value. Neither value is a service-role secret.

## Data handling

The only content returned to ChatGPT is what Jess asks the reader to retrieve. The service does not persist a copy, modify Desk records, or call an external dictionary/search service. Supabase OAuth user tokens have the existing authenticated role, so the MCP server enforces read-only behavior by exposing only fixed read tools and issuing only `GET` requests; row ownership remains enforced by Supabase RLS.
