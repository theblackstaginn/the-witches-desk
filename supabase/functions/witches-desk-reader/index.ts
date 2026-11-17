import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? "https://pqifpislzljilqatmtly.supabase.co";
const API_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const FUNCTION_URL = `${PROJECT_URL}/functions/v1/witches-desk-reader`;
const RESOURCE_METADATA_URL = `${FUNCTION_URL}/.well-known/oauth-protected-resource`;
const SCHEMA = "witches_desk";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toolDefinitions = [
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
];

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
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

async function readRows(accessToken: string, table: string, params: Record<string, string>) {
  const allowedTables = new Set(["books", "chapters", "scenes", "notes", "characters", "world_entries"]);
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
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
    "access-control-expose-headers": "www-authenticate, mcp-protocol-version",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.endsWith("/.well-known/oauth-protected-resource")) return protectedResourceMetadata(headers);
  if (request.method === "GET" && url.pathname.endsWith("/witches-desk-reader")) return json({ name: "Witch's Desk Reader", access: "read-only" }, 200, headers);
  if (request.method !== "POST") return json({ error: "Use the MCP endpoint with POST." }, 405, headers);

  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "Authorization required." }, 401, { ...headers, "www-authenticate": authorizationChallenge() });
  const accessToken = match[1];
  const user = await verifiedUser(accessToken).catch(() => null);
  if (!user) return json({ error: "A valid Witch's Desk account is required." }, 401, { ...headers, "www-authenticate": authorizationChallenge() });

  let requestBody: Record<string, unknown>;
  try { requestBody = await request.json(); }
  catch { return json({ error: "Expected a JSON-RPC request." }, 400, headers); }
  if (!requestBody || requestBody.jsonrpc !== "2.0" || typeof requestBody.method !== "string") return json({ error: "Invalid JSON-RPC request." }, 400, headers);
  const id = requestBody.id;
  if (requestBody.method === "notifications/initialized") return new Response(null, { status: 202, headers });
  if (requestBody.method === "ping") return rpc(id, {});
  if (requestBody.method === "initialize") return rpc(id, { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "witches-desk-reader", version: "0.1.0" } });
  if (requestBody.method === "tools/list") return rpc(id, { tools: toolDefinitions });
  if (requestBody.method === "tools/call") {
    const params = requestBody.params as { name?: unknown; arguments?: unknown } | undefined;
    if (typeof params?.name !== "string") return rpcError(id, -32602, "Tool name is required.");
    const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {};
    try {
      const result = await callTool(accessToken, params.name, args);
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(result) }], isError: false });
    } catch (error) {
      return rpc(id, { content: [{ type: "text", text: error instanceof Error ? error.message : "The read request failed." }], isError: true });
    }
  }
  return rpcError(id, -32601, "Method not found.");
});
