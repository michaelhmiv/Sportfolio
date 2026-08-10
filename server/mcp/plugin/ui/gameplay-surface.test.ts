import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../public-tool-registry", () => ({
  createDefaultPublicMcpDependencies: vi.fn(() => ({ marker: "default-deps" })),
  executePublicTool: vi.fn(),
}));

vi.mock("../../../auth/plugin-oauth-config", () => ({
  getPluginOAuthConfig: vi.fn(() => ({
    resource: "https://www.sportfolio.market/mcp",
    authorizationServers: ["https://www.sportfolio.market"],
  })),
}));

vi.mock("../../../auth/plugin-auth-challenge", () => ({
  pluginMcpAuthError: vi.fn((_config, detail) => ({
    isError: true,
    content: [{ type: "text", text: detail.description }],
    _meta: { auth: detail },
  })),
}));

import { createDefaultPublicMcpDependencies, executePublicTool } from "../../public-tool-registry";
import { SPORTFOLIO_SHARED_UI_RESOURCE_URI } from "./shared-resource";
import {
  buildGameplayPluginPresentationCatalog,
  registerGameplayPluginUiSurface,
  SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS,
} from "./gameplay-surface";

type ToolHandler = (args: Record<string, unknown>) => Promise<Record<string, any>>;
type ResourceHandler = () => Promise<Record<string, any>>;

function fakeServer() {
  const tools = new Map<string, { config: Record<string, any>; handler: ToolHandler }>();
  const resources = new Map<
    string,
    { uri: string; config: Record<string, any>; handler: ResourceHandler }
  >();

  return {
    server: {
      registerTool: vi.fn((name: string, config: Record<string, any>, handler: ToolHandler) => {
        tools.set(name, { config, handler });
      }),
      registerResource: vi.fn(
        (name: string, uri: string, config: Record<string, any>, handler: ResourceHandler) => {
          resources.set(name, { uri, config, handler });
        },
      ),
    } as any,
    tools,
    resources,
  };
}

function mockPublicTools(results: Record<string, unknown>) {
  vi.mocked(executePublicTool).mockImplementation(async (_context, name) => {
    const value = results[name];
    if (value instanceof Error) throw value;
    if (typeof value === "function") return (value as () => unknown)() as any;
    return value as any;
  });
}

describe("Sportfolio gameplay presentation surfaces", () => {
  const envKeys = [
    "PLUGIN_UI_ENABLED",
    "PLUGIN_UI_SCOUTING_ENABLED",
    "PLUGIN_UI_BOOSTS_ENABLED",
    "PLUGIN_UI_WATCHLISTS_ENABLED",
  ] as const;
  const originals = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of envKeys) process.env[key] = "1";
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originals[key];
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("publishes three versioned OAuth presentation contracts", () => {
    const catalog = buildGameplayPluginPresentationCatalog();
    expect(catalog).toHaveLength(3);
    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "render_scouting",
          view: "scouting",
          access: "oauth",
          featureFlag: "PLUGIN_UI_SCOUTING_ENABLED",
          resourceUri: SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS.scouting,
          readOnly: true,
          destructive: false,
          openWorld: false,
        }),
        expect.objectContaining({
          name: "render_boosts",
          view: "boosts",
          featureFlag: "PLUGIN_UI_BOOSTS_ENABLED",
          resourceUri: SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS.boosts,
        }),
        expect.objectContaining({
          name: "render_watchlist",
          view: "watchlist",
          featureFlag: "PLUGIN_UI_WATCHLISTS_ENABLED",
          resourceUri: SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS.watchlist,
        }),
      ]),
    );
    expect(Object.values(SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS)).toEqual([
      "ui://sportfolio/scouting/v1.html",
      "ui://sportfolio/boosts/v1.html",
      "ui://sportfolio/watchlist/v1.html",
    ]);
  });

  it("honors the global and per-surface feature flags", async () => {
    process.env.PLUGIN_UI_ENABLED = "0";
    const globalOff = fakeServer();
    await registerGameplayPluginUiSurface(globalOff.server, {} as any, {} as any);
    expect(globalOff.server.registerTool).not.toHaveBeenCalled();
    expect(globalOff.server.registerResource).not.toHaveBeenCalled();

    process.env.PLUGIN_UI_ENABLED = "1";
    process.env.PLUGIN_UI_SCOUTING_ENABLED = "false";
    process.env.PLUGIN_UI_BOOSTS_ENABLED = "off";
    process.env.PLUGIN_UI_WATCHLISTS_ENABLED = "no";
    const allOff = fakeServer();
    await registerGameplayPluginUiSurface(allOff.server, {} as any, {} as any);
    expect(allOff.server.registerTool).not.toHaveBeenCalled();

    delete process.env.PLUGIN_UI_SCOUTING_ENABLED;
    process.env.PLUGIN_UI_BOOSTS_ENABLED = "0";
    process.env.PLUGIN_UI_WATCHLISTS_ENABLED = "0";
    const defaultOn = fakeServer();
    await registerGameplayPluginUiSurface(defaultOn.server, {} as any, {} as any);
    expect([...defaultOn.tools.keys()]).toEqual(["render_scouting"]);
  });

  it("registers MCP app resources and uses default public dependencies when omitted", async () => {
    const fixture = fakeServer();
    await registerGameplayPluginUiSurface(fixture.server, { auth: { userId: "u1" } } as any);

    expect(createDefaultPublicMcpDependencies).toHaveBeenCalledTimes(1);
    expect(fixture.server.registerTool).toHaveBeenCalledTimes(3);
    expect(fixture.server.registerResource).toHaveBeenCalledTimes(3);

    const resource = fixture.resources.get("sportfolio-plugin-gameplay-ui-1");
    expect(resource?.uri).toBe(SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS.scouting);
    expect(resource?.config).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
    const rendered = await resource?.handler();
    expect(rendered?.contents?.[0]).toMatchObject({
      uri: SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS.scouting,
      mimeType: "text/html;profile=mcp-app",
      _meta: {
        ui: {
          domain: "https://www.sportfolio.market",
          prefersBorder: true,
          csp: { connectDomains: [], resourceDomains: ["https://www.sportfolio.market"] },
        },
      },
    });

    const tool = fixture.tools.get("render_scouting");
    expect(tool?.config).toMatchObject({
      securitySchemes: [{ type: "oauth2", scopes: ["openid"] }],
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        access: "oauth",
        ui: { resourceUri: SPORTFOLIO_SHARED_UI_RESOURCE_URI },
        "openai/outputTemplate": SPORTFOLIO_SHARED_UI_RESOURCE_URI,
      },
    });
  });

  it("returns an OAuth challenge for every gameplay view when unauthenticated", async () => {
    const fixture = fakeServer();
    await registerGameplayPluginUiSurface(fixture.server, {} as any, {} as any);

    for (const name of ["render_scouting", "render_boosts", "render_watchlist"]) {
      const result = await fixture.tools.get(name)?.handler({});
      expect(result).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: "Connect your Sportfolio account to use this interactive view.",
          },
        ],
      });
    }
    expect(executePublicTool).not.toHaveBeenCalled();
  });

  it("composes scouting from canonical account tools and clamps input", async () => {
    mockPublicTools({
      get_scout_status: { slotsUsed: 1, slotsTotal: 3 },
      list_scout_assignments: { assignments: [{ playerId: "p1" }] },
      list_scout_opportunities: { opportunities: [{ playerId: "p2" }] },
    });
    const fixture = fakeServer();
    const deps = { marker: "provided" } as any;
    await registerGameplayPluginUiSurface(
      fixture.server,
      { auth: { userId: "user_7" } } as any,
      deps,
    );

    const result = await fixture.tools.get("render_scouting")?.handler({ sport: "MLB", limit: 99 });
    expect(result?.isError).not.toBe(true);
    expect(result?.content).toEqual([{ type: "text", text: "Show Sportfolio scouting loaded." }]);
    expect(result?.structuredContent).toMatchObject({
      view: "scouting",
      data: {
        sport: "mlb",
        limit: 20,
        status: { slotsUsed: 1, slotsTotal: 3 },
        assignments: { assignments: [{ playerId: "p1" }] },
        opportunities: { opportunities: [{ playerId: "p2" }] },
        toolBindings: {
          stage: "stage_scout_assignment",
          stageBatch: "stage_scout_assignments",
          review: "render_action_review",
        },
      },
      warnings: [],
    });
    expect(result?.structuredContent.asOf).toEqual(expect.any(String));
    expect(executePublicTool).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_7", deps }),
      "list_scout_opportunities",
      { sport: "mlb", limit: 20 },
    );
    expect(vi.mocked(executePublicTool).mock.calls.map((call) => call[1])).not.toContain(
      "get_scout_roster",
    );
  });

  it("composes boosts and degrades individual provider failures without failing the view", async () => {
    vi.mocked(executePublicTool).mockImplementation(async (_context, name, args) => {
      if (name === "list_boost_candidates") throw new Error("candidate provider unavailable");
      if (name === "list_daily_boost_eligible_players") throw "non-error rejection";
      return { name, args } as any;
    });
    const fixture = fakeServer();
    await registerGameplayPluginUiSurface(
      fixture.server,
      { auth: { userId: "user_8" } } as any,
      {} as any,
    );

    const result = await fixture.tools
      .get("render_boosts")
      ?.handler({ sport: "NHL", date: "2026-08-08", limit: 0 });
    expect(result?.structuredContent).toMatchObject({
      view: "boosts",
      data: {
        sport: "nhl",
        date: "2026-08-08",
        limit: 8,
        candidates: { unavailable: true, message: "candidate provider unavailable" },
        eligible: {
          unavailable: true,
          message: "list_daily_boost_eligible_players is unavailable.",
        },
        toolBindings: {
          stageAssign: "stage_daily_boost_assign",
          stageRemove: "stage_daily_boost_remove",
          stageCommunity: "stage_community_boost_create",
          review: "render_action_review",
        },
      },
    });
    expect(executePublicTool).toHaveBeenCalledWith(expect.any(Object), "list_daily_boosts", {
      sport: "nhl",
      date: "2026-08-08",
    });
    expect(executePublicTool).toHaveBeenCalledWith(expect.any(Object), "list_daily_boost_history", {
      sport: "nhl",
      date: "2026-08-08",
      limit: 8,
    });
  });

  it("selects an explicit watchlist and loads its items", async () => {
    mockPublicTools({
      list_watchlists: { watchlists: [{ id: "first" }, { id: "second" }] },
      get_watchlist_items: { items: [{ playerId: "p1" }] },
    });
    const fixture = fakeServer();
    await registerGameplayPluginUiSurface(
      fixture.server,
      { auth: { userId: "user_9" } } as any,
      {} as any,
    );

    const result = await fixture.tools
      .get("render_watchlist")
      ?.handler({ watchlistId: "second", limit: 100 });
    expect(result?.structuredContent).toMatchObject({
      view: "watchlist",
      data: {
        watchlistId: "second",
        limit: 50,
        items: { items: [{ playerId: "p1" }] },
        toolBindings: {
          create: "create_watchlist",
          update: "update_watchlist",
          addPlayer: "add_watchlist_player",
          removePlayer: "remove_watchlist_player",
          delete: "delete_watchlist",
        },
      },
    });
    expect(executePublicTool).toHaveBeenCalledWith(expect.any(Object), "get_watchlist_items", {
      watchlistId: "second",
      limit: 50,
    });
  });

  it("infers the first watchlist id from direct and nested list shapes", async () => {
    const fixture = fakeServer();
    await registerGameplayPluginUiSurface(
      fixture.server,
      { auth: { userId: "user_10" } } as any,
      {} as any,
    );
    const tool = fixture.tools.get("render_watchlist");

    mockPublicTools({
      list_watchlists: { watchlistId: "direct" },
      get_watchlist_items: { items: [] },
    });
    const direct = await tool?.handler({});
    expect(direct?.structuredContent).toMatchObject({ data: { watchlistId: "direct" } });

    mockPublicTools({
      list_watchlists: { data: [{ watchlistId: "nested" }] },
      get_watchlist_items: { items: [] },
    });
    const nested = await tool?.handler({ limit: -3 });
    expect(nested?.structuredContent).toMatchObject({
      data: { watchlistId: "nested", limit: 1 },
    });
  });

  it("handles an empty watchlist collection without fetching items", async () => {
    mockPublicTools({ list_watchlists: { watchlists: [] } });
    const fixture = fakeServer();
    await registerGameplayPluginUiSurface(
      fixture.server,
      { auth: { userId: "user_11" } } as any,
      {} as any,
    );

    const result = await fixture.tools.get("render_watchlist")?.handler({ limit: 4 });
    expect(result?.structuredContent).toMatchObject({
      view: "watchlist",
      data: { watchlistId: null, limit: 4, items: { items: [] } },
    });
    expect(vi.mocked(executePublicTool).mock.calls.map((call) => call[1])).toEqual([
      "list_watchlists",
    ]);
  });
});
