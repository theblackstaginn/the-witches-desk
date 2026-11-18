import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? "https://pqifpislzljilqatmtly.supabase.co";
const API_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FUNCTION_URL = `${PROJECT_URL}/functions/v1/witches-desk-reader`;
const RESOURCE_METADATA_URL = `${FUNCTION_URL}/.well-known/oauth-protected-resource`;
const SCHEMA = "witches_desk";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
};

const legacyToolDefinitions: ToolDefinition[] = [
  {
    name: "list_manuscripts",
    description: "Read the authenticated Desk user's manuscript titles and brief metadata. Does not return manuscript text.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_manuscript_outline",
    description: "Read a manuscript's chapter and scene outline without retrieving scene text.",
    inputSchema: { type: "object", properties: { book_id: { type: "string", format: "uuid", description: "ID returned by list_manuscripts." } }, required: ["book_id"], additionalProperties: false },
  },
  {
    name: "read_scene",
    description: "Read one selected scene as plain text with basic paragraph, list, and emphasis formatting preserved.",
    inputSchema: { type: "object", properties: { scene_id: { type: "string", format: "uuid", description: "ID returned by get_manuscript_outline." } }, required: ["scene_id"], additionalProperties: false },
  },
  {
    name: "read_chapter",
    description: "Read one selected chapter, including its scenes, as plain text. Use only when the user asks for chapter text.",
    inputSchema: { type: "object", properties: { chapter_id: { type: "string", format: "uuid", description: "ID returned by get_manuscript_outline." } }, required: ["chapter_id"], additionalProperties: false },
  },
  {
    name: "list_notes",
    description: "Read notes owned by the authenticated Desk user, optionally limited to one manuscript.",
    inputSchema: { type: "object", properties: { book_id: { type: "string", format: "uuid", description: "Optional manuscript ID." }, limit: { type: "integer", minimum: 1, maximum: 50, default: 25 } }, additionalProperties: false },
  },
  {
    name: "list_characters",
    description: "Read characters owned by the authenticated Desk user for one manuscript.",
    inputSchema: { type: "object", properties: { book_id: { type: "string", format: "uuid" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, required: ["book_id"], additionalProperties: false },
  },
  {
    name: "list_worldbuilding",
    description: "Read worldbuilding entries owned by the authenticated Desk user for one manuscript.",
    inputSchema: { type: "object", properties: { book_id: { type: "string", format: "uuid" }, category: { type: "string", description: "Optional Desk category, such as Settings, Items, Plotlines, or Lore." }, limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, required: ["book_id"], additionalProperties: false },
  },
  {
    name: "list_world_entry_links",
    description: "Read relationships between worldbuilding entries for one manuscript.",
    inputSchema: { type: "object", properties: { book_id: { type: "string", format: "uuid" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, required: ["book_id"], additionalProperties: false },
  },
];

const grantProperties = {
  request_id: { type: "string", format: "uuid", description: "Temporary request ID supplied by The Witch’s Desk handoff." },
  capability: { type: "string", description: "Temporary read-only capability supplied by The Witch’s Desk handoff." },
};
const readerToolDefinitions = legacyToolDefinitions.map(tool => ({
  ...tool,
  inputSchema: {
    ...tool.inputSchema,
    properties: { ...grantProperties, ...tool.inputSchema.properties },
    required: [...new Set(["request_id", "capability", ...(tool.inputSchema.required ?? [])])],
  },
}));

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type, mcp-protocol-version",
  "access-control-expose-headers": "www-authenticate, mcp-protocol-version",
};

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

function rpc(id: unknown, result: unknown) {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: unknown, code: number, message: string) {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

function authorizationChallenge() {
  return `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`;
}

async function verifiedUser(accessToken: string) {
  if (!API_KEY) throw new Error("The read connector is not configured.");
  const response = await fetch(`${PROJECT_URL}/auth/v1/user`, {
    headers: { apikey: API_KEY, authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return typeof user?.id === "string" ? user : null;
}

function serviceHeaders(profileHeader: "accept-profile" | "content-profile" = "accept-profile") {
  if (!SERVICE_ROLE_KEY) throw new Error("The temporary reader service is not configured.");
  return {
    apikey: SERVICE_ROLE_KEY,
    authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    [profileHeader]: SCHEMA,
  };
}

async function hashCapability(capability: string): Promise<string> {
  const bytes = new TextEncoder().encode(capability);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

async function createReaderGrant(accessToken: string, body: Record<string, unknown>) {
  const user = await verifiedUser(accessToken).catch(() => null);
  if (!user) throw new Error("Sign in to The Witch’s Desk to create a temporary reader connection.");
  const requestId = validId(body.request_id, "request_id");
  const capability = body.capability;
  if (typeof capability !== "string" || !/^[0-9a-f]{64}$/i.test(capability)) throw new Error("A valid temporary reader capability is required.");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const response = await fetch(`${PROJECT_URL}/rest/v1/reader_grants`, {
    method: "POST",
    headers: {
      ...serviceHeaders("content-profile"),
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({ request_id: requestId, owner_id: user.id, token_hash: await hashCapability(capability), expires_at: expiresAt }),
  });
  if (!response.ok) throw new Error("The temporary reader connection could not be created.");
  return { request_id: requestId, expires_at: expiresAt };
}

async function verifyReaderGrant(args: Record<string, unknown>): Promise<string> {
  const requestId = validId(args.request_id, "request_id");
  const capability = args.capability;
  if (typeof capability !== "string" || !/^[0-9a-f]{64}$/i.test(capability)) throw new Error("A valid temporary read-only capability is required.");
  const url = new URL(`${PROJECT_URL}/rest/v1/reader_grants`);
  url.searchParams.set("request_id", `eq.${requestId}`);
  url.searchParams.set("token_hash", `eq.${await hashCapability(capability)}`);
  url.searchParams.set("expires_at", `gt.${new Date().toISOString()}`);
  url.searchParams.set("select", "owner_id");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: serviceHeaders() });
  if (!response.ok) throw new Error("The temporary reader authorization could not be checked.");
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0]?.owner_id) throw new Error("This temporary reader connection is missing or expired. Create a new one in The Witch’s Desk.");
  return validId(rows[0].owner_id, "owner_id");
}

async function readOwnedRows(ownerId: string, table: string, params: Record<string, string>) {
  const allowedTables = new Set(["books", "chapters", "scenes", "notes", "characters", "world_entries", "world_entry_links"]);
  if (!allowedTables.has(table)) throw new Error("This read is not available.");
  const url = new URL(`${PROJECT_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("owner_id", `eq.${ownerId}`);
  const response = await fetch(url, { method: "GET", headers: serviceHeaders() });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("The signed-in Desk account is not allowed to read this record.");
    throw new Error(`Desk read failed (${response.status}).`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("The Desk returned an unexpected response.");
  return rows;
}

async function readRows(accessToken: string, table: string, params: Record<string, string>) {
  const allowedTables = new Set(["books", "chapters", "scenes", "notes", "characters", "world_entries", "world_entry_links"]);
  if (!allowedTables.has(table)) throw new Error("This read is not available.");
  const url = new URL(`${PROJECT_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: API_KEY,
      authorization: `Bearer ${accessToken}`,
      "accept-profile": SCHEMA,
    },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Supabase denied this read for the signed-in account.");
    throw new Error(`Desk read failed (${response.status}).`);
  }
  const result = await response.json();
  if (!Array.isArray(result)) throw new Error("The Desk returned an unexpected response.");
  return result;
}

function validId(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${label} must be a valid Desk ID.`);
  return value;
}

function boundedLimit(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("limit must be a positive whole number.");
  return Math.min(parsed, maximum);
}

function htmlToText(html: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "• ")
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|blockquote|ul|ol)\s*>/gi, "\n\n")
    .replace(/<\s*(strong|b)\b[^>]*>/gi, "**")
    .replace(/<\s*\/\s*(strong|b)\s*>/gi, "**")
    .replace(/<\s*(em|i)\b[^>]*>/gi, "*")
    .replace(/<\s*\/\s*(em|i)\s*>/gi, "*")
    .replace(/<\s*u\b[^>]*>/gi, "")
    .replace(/<\s*\/\s*u\s*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
      if (token[0] === "#") {
        const code = token[1]?.toLowerCase() === "x" ? Number.parseInt(token.slice(2), 16) : Number.parseInt(token.slice(1), 10);
        return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
      return entities[token.toLowerCase()] ?? entity;
    })
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chapterScenesWithText(rows: Record<string, unknown>[]) {
  let remaining = 50000;
  let truncated = false;
  const scenes = rows.map(row => {
    const html = typeof row.content === "string" ? row.content : (row.content as { html?: unknown } | null)?.html;
    const fullText = typeof html === "string" ? htmlToText(html) : "";
    const content = fullText.slice(0, Math.max(0, remaining));
    if (content.length < fullText.length) truncated = true;
    remaining -= content.length;
    return { id: row.id, title: row.title, word_count: row.word_count, content };
  });
  return { scenes, truncated };
}

async function callTool(accessToken: string, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "list_manuscripts": {
      const rows = await readRows(accessToken, "books", { select: "id,title,description,pov_mode,updated_at", order: "updated_at.desc", limit: "50" });
      return rows;
    }
    case "get_manuscript_outline": {
      const bookId = validId(args.book_id, "book_id");
      const [books, chapters, scenes] = await Promise.all([
        readRows(accessToken, "books", { id: `eq.${bookId}`, select: "id,title,description,pov_mode", limit: "1" }),
        readRows(accessToken, "chapters", { book_id: `eq.${bookId}`, select: "id,title,sort_order", order: "sort_order.asc", limit: "200" }),
        readRows(accessToken, "scenes", { book_id: `eq.${bookId}`, select: "id,chapter_id,title,pov_character_id,sort_order,word_count,updated_at", order: "sort_order.asc", limit: "500" }),
      ]);
      if (!books.length) throw new Error("That manuscript is unavailable to the signed-in Desk account.");
      return { manuscript: books[0], chapters: chapters.map(chapter => ({ ...chapter, scenes: scenes.filter(scene => scene.chapter_id === chapter.id) })) };
    }
    case "read_scene": {
      const sceneId = validId(args.scene_id, "scene_id");
      const rows = await readRows(accessToken, "scenes", { id: `eq.${sceneId}`, select: "id,book_id,chapter_id,title,content,word_count,updated_at", limit: "1" });
      if (!rows.length) throw new Error("That scene is unavailable to the signed-in Desk account.");
      const row = rows[0];
      const html = typeof row.content === "string" ? row.content : row.content?.html;
      const content = typeof html === "string" ? htmlToText(html) : "";
      const truncated = content.length > 50000;
      return { id: row.id, book_id: row.book_id, chapter_id: row.chapter_id, title: row.title, word_count: row.word_count, updated_at: row.updated_at, content: truncated ? `${content.slice(0, 50000)}\n\n[Scene text truncated at 50,000 characters.]` : content };
    }
    case "read_chapter": {
      const chapterId = validId(args.chapter_id, "chapter_id");
      const chapters = await readRows(accessToken, "chapters", { id: `eq.${chapterId}`, select: "id,book_id,title,sort_order", limit: "1" });
      if (!chapters.length) throw new Error("That chapter is unavailable to the signed-in Desk account.");
      const rows = await readRows(accessToken, "scenes", { chapter_id: `eq.${chapterId}`, select: "id,title,content,word_count,sort_order", order: "sort_order.asc", limit: "200" });
      const result = chapterScenesWithText(rows);
      return { chapter: chapters[0], ...result, ...(result.truncated ? { note: "Chapter text is limited to 50,000 characters per request." } : {}) };
    }
    case "list_notes": {
      const params: Record<string, string> = { select: "id,book_id,title,body,category,updated_at", order: "updated_at.desc", limit: String(boundedLimit(args.limit, 25, 50)) };
      if (args.book_id !== undefined) params.book_id = `eq.${validId(args.book_id, "book_id")}`;
      return await readRows(accessToken, "notes", params);
    }
    case "list_characters": {
      const bookId = validId(args.book_id, "book_id");
      return await readRows(accessToken, "characters", { book_id: `eq.${bookId}`, select: "id,book_id,name,description,sigil,created_at", order: "created_at.asc", limit: String(boundedLimit(args.limit, 50, 100)) });
    }
    case "list_worldbuilding": {
      const bookId = validId(args.book_id, "book_id");
      const params: Record<string, string> = { book_id: `eq.${bookId}`, select: "id,book_id,category,title,summary,details,created_at,updated_at", order: "category.asc,title.asc", limit: String(boundedLimit(args.limit, 50, 100)) };
      if (args.category !== undefined) {
        if (typeof args.category !== "string" || args.category.length > 80) throw new Error("category must be a short text value.");
        params.category = `eq.${args.category}`;
      }
      return await readRows(accessToken, "world_entries", params);
    }
    case "list_world_entry_links": {
      const bookId = validId(args.book_id, "book_id");
      return await readRows(accessToken, "world_entry_links", { book_id: `eq.${bookId}`, select: "id,from_entry_id,to_entry_id,relation,notes,created_at", order: "created_at.asc", limit: String(boundedLimit(args.limit, 50, 100)) });
    }
    default:
      throw new Error("Unknown read tool.");
  }
}

async function callGrantTool(ownerId: string, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "list_manuscripts":
      return await readOwnedRows(ownerId, "books", { select: "id,title,description,pov_mode,updated_at", order: "updated_at.desc", limit: "50" });
    case "get_manuscript_outline": {
      const bookId = validId(args.book_id, "book_id");
      const [books, chapters, scenes] = await Promise.all([
        readOwnedRows(ownerId, "books", { id: `eq.${bookId}`, select: "id,title,description,pov_mode", limit: "1" }),
        readOwnedRows(ownerId, "chapters", { book_id: `eq.${bookId}`, select: "id,title,sort_order", order: "sort_order.asc", limit: "200" }),
        readOwnedRows(ownerId, "scenes", { book_id: `eq.${bookId}`, select: "id,chapter_id,title,pov_character_id,sort_order,word_count,updated_at", order: "sort_order.asc", limit: "500" }),
      ]);
      if (!books.length) throw new Error("That manuscript is unavailable to the signed-in Desk account.");
      return { manuscript: books[0], chapters: chapters.map(chapter => ({ ...chapter, scenes: scenes.filter(scene => scene.chapter_id === chapter.id) })) };
    }
    case "read_scene": {
      const sceneId = validId(args.scene_id, "scene_id");
      const rows = await readOwnedRows(ownerId, "scenes", { id: `eq.${sceneId}`, select: "id,book_id,chapter_id,title,content,word_count,updated_at", limit: "1" });
      if (!rows.length) throw new Error("That scene is unavailable to the signed-in Desk account.");
      const row = rows[0];
      const html = typeof row.content === "string" ? row.content : (row.content as { html?: unknown } | null)?.html;
      const content = typeof html === "string" ? htmlToText(html) : "";
      const truncated = content.length > 50000;
      return { id: row.id, book_id: row.book_id, chapter_id: row.chapter_id, title: row.title, word_count: row.word_count, updated_at: row.updated_at, content: truncated ? `${content.slice(0, 50000)}\n\n[Scene text truncated at 50,000 characters.]` : content };
    }
    case "read_chapter": {
      const chapterId = validId(args.chapter_id, "chapter_id");
      const chapters = await readOwnedRows(ownerId, "chapters", { id: `eq.${chapterId}`, select: "id,book_id,title,sort_order", limit: "1" });
      if (!chapters.length) throw new Error("That chapter is unavailable to the signed-in Desk account.");
      const rows = await readOwnedRows(ownerId, "scenes", { chapter_id: `eq.${chapterId}`, select: "id,title,content,word_count,sort_order", order: "sort_order.asc", limit: "200" });
      const result = chapterScenesWithText(rows);
      return { chapter: chapters[0], ...result, ...(result.truncated ? { note: "Chapter text is limited to 50,000 characters per request." } : {}) };
    }
    case "list_notes": {
      const params: Record<string, string> = { select: "id,book_id,title,body,category,updated_at", order: "updated_at.desc", limit: String(boundedLimit(args.limit, 25, 50)) };
      if (args.book_id !== undefined) params.book_id = `eq.${validId(args.book_id, "book_id")}`;
      return await readOwnedRows(ownerId, "notes", params);
    }
    case "list_characters": {
      const bookId = validId(args.book_id, "book_id");
      return await readOwnedRows(ownerId, "characters", { book_id: `eq.${bookId}`, select: "id,book_id,name,description,sigil,created_at", order: "created_at.asc", limit: String(boundedLimit(args.limit, 50, 100)) });
    }
    case "list_worldbuilding": {
      const bookId = validId(args.book_id, "book_id");
      const params: Record<string, string> = { book_id: `eq.${bookId}`, select: "id,book_id,category,title,summary,details,created_at,updated_at", order: "category.asc,title.asc", limit: String(boundedLimit(args.limit, 50, 100)) };
      if (args.category !== undefined) {
        if (typeof args.category !== "string" || args.category.length > 80) throw new Error("category must be a short text value.");
        params.category = `eq.${args.category}`;
      }
      return await readOwnedRows(ownerId, "world_entries", params);
    }
    case "list_world_entry_links": {
      const bookId = validId(args.book_id, "book_id");
      return await readOwnedRows(ownerId, "world_entry_links", { book_id: `eq.${bookId}`, select: "id,from_entry_id,to_entry_id,relation,notes,created_at", order: "created_at.asc", limit: String(boundedLimit(args.limit, 50, 100)) });
    }
    default:
      throw new Error("Unknown read tool.");
  }
}

function protectedResourceMetadata(headers: HeadersInit) {
  return json({
    resource: FUNCTION_URL,
    authorization_servers: [`${PROJECT_URL}/auth/v1`],
    scopes_supported: ["openid"],
    bearer_methods_supported: ["header"],
  }, 200, headers);
}

Deno.serve(async request => {
  const headers = CORS_HEADERS;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.endsWith("/.well-known/oauth-protected-resource")) return protectedResourceMetadata(headers);
  if (request.method === "GET" && url.pathname.endsWith("/witches-desk-reader")) return json({ name: "Witch's Desk Reader", access: "read-only" }, 200, headers);
  if (request.method !== "POST") return json({ error: "Use the MCP endpoint with POST." }, 405, headers);

  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  let requestBody: Record<string, unknown>;
  try { requestBody = await request.json(); }
  catch { return json({ error: "Expected a JSON-RPC request." }, 400, headers); }

  const accessToken = match?.[1] ?? "";
  if (requestBody?.action === "create_reader_grant") {
    if (!accessToken) return json({ error: "Sign in to The Witch’s Desk to create a temporary reader connection." }, 401, headers);
    try { return json(await createReaderGrant(accessToken, requestBody), 200, headers); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "The temporary reader connection failed." }, 400, headers); }
  }

  if (!requestBody || requestBody.jsonrpc !== "2.0" || typeof requestBody.method !== "string") return json({ error: "Invalid JSON-RPC request." }, 400, headers);
  const authenticatedUser = accessToken ? await verifiedUser(accessToken).catch(() => null) : null;
  const id = requestBody.id;
  if (requestBody.method === "notifications/initialized") return new Response(null, { status: 202, headers });
  if (requestBody.method === "ping") return rpc(id, {});
  if (requestBody.method === "initialize") return rpc(id, { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "witches-desk-reader", version: "0.2.0" } });
  if (requestBody.method === "tools/list") return rpc(id, { tools: authenticatedUser ? legacyToolDefinitions : readerToolDefinitions });
  if (requestBody.method === "tools/call") {
    const params = requestBody.params as { name?: unknown; arguments?: unknown } | undefined;
    if (typeof params?.name !== "string") return rpcError(id, -32602, "Tool name is required.");
    const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {};
    try {
      const result = authenticatedUser
        ? await callTool(accessToken, params.name, args)
        : await callGrantTool(await verifyReaderGrant(args), params.name, args);
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(result) }], isError: false });
    } catch (error) {
      return rpc(id, { content: [{ type: "text", text: error instanceof Error ? error.message : "The read request failed." }], isError: true });
    }
  }
  return rpcError(id, -32601, "Method not found.");
});
