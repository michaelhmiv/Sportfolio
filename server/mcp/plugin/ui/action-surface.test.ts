import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../gameplay-transactions", () => ({
  getGameplayTransaction: vi.fn(),
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

import { getGameplayTransaction } from "../../gameplay-transactions";
import {
  buildActionPluginPresentationCatalog,
  registerActionPluginUiSurface,
  SPORTFOLIO_ACTION_UI_RESOURCE_URI,
} from "./action-surface";

type ToolHandler = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
type ResourceHandler = () => Promise<Record<string, unknown>>;

function fakeServer() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: ToolHandler }>();
  const resources = new Map<
    string,
    { uri: string; config: Record<string, unknown>; handler: ResourceHandler }
  >();

  return {
    server: {
      registerTool: vi.fn(
        (name: string, config: Record<string, unknown>, handler: ToolHandler) => {
          tools.set(name, { config, handler });
        },
      ),
      registerResource: vi.fn(
        (
          name: string,
          uri: string,
          config: Record<string, unknown>,
          handler: ResourceHandler,
        ) => {
          resources.set(name, { uri, config, handler });
        },
      ),
    } as any,
    tools,
    resources,
  };
}

describe("Sportfolio generic action review presentation", () => {
  const originalUiEnabled = process.env.PLUGIN_UI_ENABLED;
  const originalActionEnabled = process.env.PLUGIN_UI_ACTION_REVIEW_V2_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLUGIN_UI_ENABLED = "1";
    process.env.PLUGIN_UI_ACTION_REVIEW_V2_ENABLED = "1";
  });

  afterEach(() => {
    if (originalUiEnabled == null) delete process.env.PLUGIN_UI_ENABLED;
    else process.env.PLUGIN_UI_ENABLED = originalUiEnabled;
    if (originalActionEnabled == null) delete process.env.PLUGIN_UI_ACTION_REVIEW_V2_ENABLED;
    else process.env.PLUGIN_UI_ACTION_REVIEW_V2_ENABLED = originalActionEnabled;
  });

  it("publishes a versioned, read-only OAuth presentation contract", () => {
    const [entry] = buildActionPluginPresentationCatalog();
    expect(entry).toMatchObject({
      name: "render_action_review",
      view: "action_review",
      access: "oauth",
      featureFlag: "PLUGIN_UI_ACTION_REVIEW_V2_ENABLED",
      resourceUri: SPORTFOLIO_ACTION_UI_RESOURCE_URI,
      readOnly: true,
      destructive: false,
      openWorld: false,
    });
    expect(entry.resourceUri).toBe("ui://sportfolio/action-review/v1.html");
    expect(entry.fixtureArgs.transactionId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("does not register when the global or action-review UI flag is disabled", async () => {
    const globallyDisabled = fakeServer();
    process.env.PLUGIN_UI_ENABLED = "0";
    await registerActionPluginUiSurface(globallyDisabled.server, {} as any);
    expect(globallyDisabled.server.registerTool).not.toHaveBeenCalled();
    expect(globallyDisabled.server.registerResource).not.toHaveBeenCalled();

    process.env.PLUGIN_UI_ENABLED = "1";
    process.env.PLUGIN_UI_ACTION_REVIEW_V2_ENABLED = "false";
    const actionDisabled = fakeServer();
    await registerActionPluginUiSurface(actionDisabled.server, {} as any);
    expect(actionDisabled.server.registerTool).not.toHaveBeenCalled();
    expect(actionDisabled.server.registerResource).not.toHaveBeenCalled();
  });

  it("registers the MCP app resource and renders the exact pending transaction", async () => {
    const fixture = fakeServer();
    const transactionId = "11111111-1111-4111-8111-111111111111";
    vi.mocked(getGameplayTransaction).mockResolvedValue({
      transactionId,
      status: "pending_confirmation",
      summary: "Buy virtual shares of Test Player.",
      warnings: ["Virtual gameplay transaction."],
      action: {
        actionType: "pool_buy",
        playerId: "player_1",
        sbAmount: 250,
      },
    } as any);

    await registerActionPluginUiSurface(fixture.server, {
      auth: { userId: "user_1" },
    } as any);

    expect(fixture.server.registerResource).toHaveBeenCalledTimes(1);
    expect(fixture.server.registerTool).toHaveBeenCalledTimes(1);

    const resource = fixture.resources.get("sportfolio-plugin-action-review-ui");
    expect(resource?.uri).toBe(SPORTFOLIO_ACTION_UI_RESOURCE_URI);
    const resourceResult = await resource?.handler();
    expect(resourceResult?.contents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: SPORTFOLIO_ACTION_UI_RESOURCE_URI,
          mimeType: "text/html;profile=mcp-app",
        }),
      ]),
    );

    const tool = fixture.tools.get("render_action_review");
    const result = await tool?.handler({ transactionId });
    expect(getGameplayTransaction).toHaveBeenCalledWith("user_1", transactionId);
    expect(result?.isError).not.toBe(true);
    expect(result?.content).toEqual([
      {
        type: "text",
        text: "The staged Sportfolio action is ready for explicit confirmation or cancellation.",
      },
    ]);
    expect(result?.structuredContent).toMatchObject({
      view: "action_review",
      data: {
        transactionId,
        summary: "Buy virtual shares of Test Player.",
        confirmationRequired: true,
        status: "pending_confirmation",
        transaction: {
          transactionId,
          status: "pending_confirmation",
        },
      },
    });
  });

  it("returns the account-linking challenge when the viewer is not authenticated", async () => {
    const fixture = fakeServer();
    await registerActionPluginUiSurface(fixture.server, {} as any);
    const tool = fixture.tools.get("render_action_review");
    const result = await tool?.handler({
      transactionId: "22222222-2222-4222-8222-222222222222",
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "Connect your Sportfolio account to review this staged action.",
        },
      ],
    });
    expect(getGameplayTransaction).not.toHaveBeenCalled();
  });

  it("renders completed status and sanitizes transaction-load failures", async () => {
    const fixture = fakeServer();
    await registerActionPluginUiSurface(fixture.server, {
      auth: { userId: "user_1" },
    } as any);
    const tool = fixture.tools.get("render_action_review");
    const transactionId = "33333333-3333-4333-8333-333333333333";

    vi.mocked(getGameplayTransaction).mockResolvedValueOnce({
      transactionId,
      status: "completed",
      summary: "Virtual action completed.",
      warnings: [],
      action: { actionType: "daily_boost_assign", playerId: "player_2" },
    } as any);
    const completed = await tool?.handler({ transactionId });
    expect(completed?.content).toEqual([
      { type: "text", text: "The Sportfolio action is completed." },
    ]);
    expect(completed?.structuredContent).toMatchObject({
      data: { confirmationRequired: false, status: "completed" },
    });

    vi.mocked(getGameplayTransaction).mockRejectedValueOnce(new Error("Transaction not found"));
    const failed = await tool?.handler({ transactionId });
    expect(failed).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Transaction not found" }],
      structuredContent: {
        view: "action_review",
        data: {
          code: "plugin_ui_action_review_failed",
          message: "Transaction not found",
        },
      },
    });

    vi.mocked(getGameplayTransaction).mockRejectedValueOnce("unknown failure");
    const unknownFailure = await tool?.handler({ transactionId });
    expect(unknownFailure).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Sportfolio could not load this action." }],
    });
  });
});
