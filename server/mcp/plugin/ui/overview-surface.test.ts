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
import {
  buildOverviewPluginPresentationCatalog,
  registerOverviewPluginUiSurface,
  SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS,
} from "./overview-surface";

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
  vi.mocked(executePublicTool).mockImplementation(async (_context, name, args) => {
    const value = results[name];
    if (value instanceof Error) throw value;
    if (typeof value === "function")
      return (value as (args: Record<string, unknown>) => unknown)(args || {}) as any;
    return value as any;
  });
}

describe("Sportfolio overview presentation surfaces", () => {
  const envKeys = [
    "PLUGIN_UI_ENABLED",
    "PLUGIN_UI_DASHBOARD_ENABLED",
    "PLUGIN_UI_COLLECTIONS_ENABLED",
    "PLUGIN_UI_RANKINGS_ENABLED",
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
    const catalog = buildOverviewPluginPresentationCatalog();
    expect(catalog).toHaveLength(3);
    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "render_dashboard",
          view: "dashboard",
          sourceToolName: "get_dashboard_overview",
          featureFlag: "PLUGIN_UI_DASHBOARD_ENABLED",
          resourceUri: SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS.dashboard,
          readOnly: true,
          destructive: false,
          openWorld: false,
        }),
        expect.objectContaining({
          name: "render_collections",
          view: "collections",
          sourceToolName: "list_collections",
          featureFlag: "PLUGIN_UI_COLLECTIONS_ENABLED",
          resourceUri: SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS.collections,
        }),
        expect.objectContaining({
          name: "render_rankings",
          view: "rankings",
          sourceToolName: "get_leaderboard",
          featureFlag: "PLUGIN_UI_RANKINGS_ENABLED",
          resourceUri: SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS.rankings,
        }),
      ]),
    );
    expect(Object.values(SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS)).toEqual([
      "ui://sportfolio/dashboard/v1.html",
      "ui://sportfolio/collections/v1.html",
      "ui://sportfolio/rankings/v1.html",
    ]);
  });

  it("honors global and per-surface feature flags", async () => {
    process.env.PLUGIN_UI_ENABLED = "0";
    const globalOff = fakeServer();
    await registerOverviewPluginUiSurface(globalOff.server, {} as any, {} as any);
    expect(globalOff.server.registerTool).not.toHaveBeenCalled();

    process.env.PLUGIN_UI_ENABLED = "1";
    process.env.PLUGIN_UI_DASHBOARD_ENABLED = "false";
    process.env.PLUGIN_UI_COLLECTIONS_ENABLED = "off";
    process.env.PLUGIN_UI_RANKINGS_ENABLED = "no";
    const allOff = fakeServer();
    await registerOverviewPluginUiSurface(allOff.server, {} as any, {} as any);
    expect(allOff.server.registerTool).not.toHaveBeenCalled();

    delete process.env.PLUGIN_UI_DASHBOARD_ENABLED;
    const defaultOn = fakeServer();
    await registerOverviewPluginUiSurface(defaultOn.server, {} as any, {} as any);
    expect([...defaultOn.tools.keys()]).toEqual(["render_dashboard"]);
  });

  it("registers MCP app resources and default dependencies", async () => {
    const fixture = fakeServer();
    await registerOverviewPluginUiSurface(fixture.server, { auth: { userId: "u1" } } as any);
    expect(createDefaultPublicMcpDependencies).toHaveBeenCalledTimes(1);
    expect(fixture.server.registerTool).toHaveBeenCalledTimes(3);
    expect(fixture.server.registerResource).toHaveBeenCalledTimes(3);

    const resource = fixture.resources.get("sportfolio-plugin-overview-ui-1");
    expect(resource?.uri).toBe(SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS.dashboard);
    const rendered = await resource?.handler();
    expect(rendered?.contents?.[0]).toMatchObject({
      uri: SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS.dashboard,
      mimeType: "text/html;profile=mcp-app",
      _meta: {
        ui: {
          domain: "https://www.sportfolio.market",
          prefersBorder: true,
          csp: { connectDomains: [], resourceDomains: ["https://www.sportfolio.market"] },
        },
      },
    });
  });

  it("requires OAuth before loading overview data", async () => {
    const fixture = fakeServer();
    await registerOverviewPluginUiSurface(fixture.server, {} as any, {} as any);
    for (const name of ["render_dashboard", "render_collections", "render_rankings"]) {
      const result = await fixture.tools.get(name)?.handler({});
      expect(result).toMatchObject({
        isError: true,
        content: [
          { type: "text", text: "Connect your Sportfolio account to use this interactive view." },
        ],
      });
    }
    expect(executePublicTool).not.toHaveBeenCalled();
  });

  it("loads the dashboard from the canonical dashboard tool and clamps limits", async () => {
    mockPublicTools({ get_dashboard_overview: { overview: { netWorth: 1250 } } });
    const fixture = fakeServer();
    const deps = { marker: "provided" } as any;
    await registerOverviewPluginUiSurface(
      fixture.server,
      { auth: { userId: "user_1" } } as any,
      deps,
    );
    const result = await fixture.tools.get("render_dashboard")?.handler({ recentLotsLimit: 99 });
    expect(result?.structuredContent).toMatchObject({
      view: "dashboard",
      data: {
        recentLotsLimit: 20,
        dashboard: { overview: { netWorth: 1250 } },
      },
      warnings: [],
    });
    expect(executePublicTool).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1", deps }),
      "get_dashboard_overview",
      { recentLotsLimit: 20 },
    );
  });

  it("lists collections and loads selected detail through the canonical detail tool", async () => {
    mockPublicTools({
      list_collections: { collections: [{ collectionType: "team", targetId: "BOS" }] },
      get_collection_detail: {
        collection: { collectionType: "team", targetId: "BOS" },
        ownedPlayers: [],
      },
    });
    const fixture = fakeServer();
    await registerOverviewPluginUiSurface(
      fixture.server,
      { auth: { userId: "user_2" } } as any,
      {} as any,
    );
    const result = await fixture.tools
      .get("render_collections")
      ?.handler({ type: "team", targetId: "BOS" });
    expect(result?.structuredContent).toMatchObject({
      view: "collections",
      data: {
        type: "team",
        targetId: "BOS",
        collections: { collections: [{ collectionType: "team", targetId: "BOS" }] },
        selected: { collection: { collectionType: "team", targetId: "BOS" }, ownedPlayers: [] },
      },
      warnings: [],
    });
    expect(executePublicTool).toHaveBeenCalledWith(expect.any(Object), "get_collection_detail", {
      type: "team",
      targetId: "BOS",
    });
  });

  it("loads rankings from the shared canonical leaderboard tool", async () => {
    mockPublicTools({
      get_leaderboard: {
        category: "portfolioValue",
        categoryLabel: "Portfolio Value",
        leaderboard: [{ rank: 1, userId: "u1", username: "leader", value: 1000 }],
        currentUser: { rank: 3, userId: "user_3", username: "me", value: 700 },
      },
    });
    const fixture = fakeServer();
    await registerOverviewPluginUiSurface(
      fixture.server,
      { auth: { userId: "user_3" } } as any,
      {} as any,
    );
    const result = await fixture.tools
      .get("render_rankings")
      ?.handler({ category: "portfolioValue", limit: 100 });
    expect(result?.structuredContent).toMatchObject({
      view: "rankings",
      data: {
        category: "portfolioValue",
        limit: 50,
        rankings: { category: "portfolioValue", categoryLabel: "Portfolio Value" },
      },
      warnings: [],
    });
    expect(executePublicTool).toHaveBeenCalledWith(expect.any(Object), "get_leaderboard", {
      category: "portfolioValue",
      limit: 50,
    });
  });

  it("degrades a failed canonical read into a warning without failing the view", async () => {
    mockPublicTools({ get_dashboard_overview: new Error("dashboard unavailable") });
    const fixture = fakeServer();
    await registerOverviewPluginUiSurface(
      fixture.server,
      { auth: { userId: "user_4" } } as any,
      {} as any,
    );
    const result = await fixture.tools.get("render_dashboard")?.handler({});
    expect(result?.isError).not.toBe(true);
    expect(result?.structuredContent).toMatchObject({
      view: "dashboard",
      data: { dashboard: { unavailable: true } },
      warnings: ["Sportfolio could not complete this request."],
    });
  });
});
