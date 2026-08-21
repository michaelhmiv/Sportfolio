type JsonRecord = Record<string, unknown>;

const endpoint = process.env.PLUGIN_UI_SMOKE_URL?.trim();
if (!endpoint) {
  throw new Error(
    "Set PLUGIN_UI_SMOKE_URL to the canonical Sportfolio MCP URL before running this probe.",
  );
}

const parsedEndpoint = new URL(endpoint);
if (parsedEndpoint.protocol !== "https:" && parsedEndpoint.hostname !== "127.0.0.1") {
  throw new Error(`PLUGIN_UI_SMOKE_URL must use HTTPS outside localhost: ${endpoint}`);
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function parseRpcResponse(body: string, contentType: string): JsonRecord {
  if (contentType.includes("text/event-stream")) {
    const dataLine = body.split(/\r?\n/).find((line) => line.startsWith("data:"));
    if (!dataLine)
      throw new Error(`MCP SSE response contained no data event: ${body.slice(0, 300)}`);
    return record(JSON.parse(dataLine.slice(5).trim()));
  }
  return record(JSON.parse(body));
}

async function call(method: string, params: JsonRecord, id: number): Promise<JsonRecord> {
  const response = await fetch(endpoint!, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-method": method,
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(`${method} returned HTTP ${response.status}: ${body.slice(0, 400)}`);
  const payload = parseRpcResponse(body, response.headers.get("content-type") || "");
  if (payload.error)
    throw new Error(`${method} returned JSON-RPC error: ${JSON.stringify(payload.error)}`);
  return record(payload.result);
}

async function fetchJson(url: string): Promise<JsonRecord> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return record(await response.json());
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is missing.`);
  return value;
}

async function main() {
  const tools = await call("tools/list", {}, 1);
  const listedTools = Array.isArray(tools.tools) ? tools.tools.map(record) : [];
  const presentationTools = listedTools.filter((tool) =>
    requireString(tool.name, "tool.name").startsWith("render_"),
  );
  if (presentationTools.length !== 15) {
    throw new Error(`Expected 15 presentation tools, found ${presentationTools.length}.`);
  }

  const resourceUris = new Set(
    presentationTools.map((tool) => record(record(tool._meta).ui).resourceUri),
  );
  if (resourceUris.size !== 1)
    throw new Error(`Presentation tools advertise multiple UI resources: ${[...resourceUris]}`);
  const resourceUri = requireString([...resourceUris][0], "shared resource URI");
  if (!/^ui:\/\/sportfolio\/app\/[a-f0-9]{16}\.html$/.test(resourceUri)) {
    throw new Error(`Shared resource is not content-addressed: ${resourceUri}`);
  }

  const resources = await call("resources/list", {}, 2);
  const uiResources = (Array.isArray(resources.resources) ? resources.resources : [])
    .map(record)
    .filter((resource) =>
      requireString(resource.uri, "resource.uri").startsWith("ui://sportfolio/app/"),
    );
  if (uiResources.length !== 1 || uiResources[0].uri !== resourceUri) {
    throw new Error(
      `resources/list did not expose exactly the shared UI resource: ${JSON.stringify(uiResources)}`,
    );
  }

  const resourceRead = await call("resources/read", { uri: resourceUri }, 3);
  const contents = Array.isArray(resourceRead.contents) ? resourceRead.contents.map(record) : [];
  const html = requireString(contents[0]?.text, "UI resource HTML");
  if (contents[0]?.mimeType !== "text/html;profile=mcp-app") {
    throw new Error(`UI resource MIME type is incorrect: ${String(contents[0]?.mimeType)}`);
  }
  if (!html.includes('<script type="module">') || /<script[^>]+src=/i.test(html)) {
    throw new Error("UI resource is not a self-contained inline module.");
  }

  const movers = await call(
    "tools/call",
    { name: "render_market_movers", arguments: { category: "gainers", range: "1D", limit: 6 } },
    4,
  );
  const moversContent = record(movers.structuredContent);
  if (movers.isError || moversContent.view !== "market_movers") {
    throw new Error(`Public market-movers render failed: ${JSON.stringify(movers)}`);
  }

  const items = Array.isArray(record(moversContent.data).items)
    ? (record(moversContent.data).items as unknown[]).map(record)
    : [];
  const playerId = record(items[0]?.player).playerId;
  if (typeof playerId === "string" && playerId.length > 0) {
    const playerMarket = await call(
      "tools/call",
      { name: "render_player_market", arguments: { playerId, range: "1D" } },
      5,
    );
    if (playerMarket.isError || record(playerMarket.structuredContent).view !== "player_market") {
      throw new Error(
        `Public player-market render failed for ${playerId}: ${JSON.stringify(playerMarket)}`,
      );
    }
  }

  const portfolio = await call("tools/call", { name: "render_portfolio", arguments: {} }, 6);
  const challenge = record(portfolio._meta)["mcp/www_authenticate"];
  if (!portfolio.isError || !Array.isArray(challenge)) {
    throw new Error("Protected portfolio render did not return an MCP OAuth challenge.");
  }

  const origin = parsedEndpoint.origin;
  const protectedResource = await fetchJson(`${origin}/.well-known/oauth-protected-resource`);
  const issuer = requireString(
    Array.isArray(protectedResource.authorization_servers)
      ? protectedResource.authorization_servers[0]
      : undefined,
    "OAuth issuer",
  ).replace(/\/$/, "");
  const issuerUrl = new URL(issuer);
  const discoveryUrl = `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname === "/" ? "" : issuerUrl.pathname.replace(/\/$/, "")}`;
  const discovery = await fetchJson(discoveryUrl);
  if (discovery.issuer !== issuer)
    throw new Error("OAuth discovery issuer does not match protected-resource metadata.");
  const jwksUri = requireString(discovery.jwks_uri, "JWKS URI");
  const jwks = await fetchJson(jwksUri);
  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0)
    throw new Error("OAuth JWKS contains no keys.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint,
        toolCount: listedTools.length,
        presentationToolCount: presentationTools.length,
        resourceUri,
        resourceBytes: Buffer.byteLength(html, "utf8"),
        publicViews: ["market_movers", "player_market"],
        oauth: { issuer, discoveryUrl, jwksKeyCount: jwks.keys.length },
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
