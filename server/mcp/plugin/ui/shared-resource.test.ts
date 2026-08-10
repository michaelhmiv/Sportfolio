import { describe, expect, it } from "vitest";
import {
  installSharedPluginUiResource,
  SPORTFOLIO_SHARED_UI_RESOURCE_URI,
} from "./shared-resource";

describe("shared Sportfolio plugin UI resource", () => {
  it("suppresses duplicate Sportfolio UI resources and rewrites tool templates", () => {
    const resources: any[][] = [];
    const tools: any[][] = [];
    const server = {
      registerResource: (...args: any[]) => {
        resources.push(args);
        return undefined;
      },
      registerTool: (...args: any[]) => {
        tools.push(args);
        return undefined;
      },
    };

    installSharedPluginUiResource(server as any);

    server.registerResource(
      "legacy-player-market",
      "ui://sportfolio/player-market/v1.html",
      { mimeType: "text/html;profile=mcp-app" },
      async () => ({ contents: [] }),
    );
    server.registerResource(
      "unrelated-resource",
      "docs://sportfolio/help",
      { mimeType: "text/plain" },
      async () => ({ contents: [] }),
    );

    server.registerTool(
      "render_player_market",
      {
        _meta: {
          ui: { resourceUri: "ui://sportfolio/player-market/v1.html" },
          "openai/outputTemplate": "ui://sportfolio/player-market/v1.html",
        },
      },
      async () => ({}),
    );

    expect(resources).toHaveLength(2);
    expect(resources[0][1]).toBe(SPORTFOLIO_SHARED_UI_RESOURCE_URI);
    expect(resources[1][1]).toBe("docs://sportfolio/help");

    expect(tools).toHaveLength(1);
    expect(tools[0][1]._meta.ui.resourceUri).toBe(SPORTFOLIO_SHARED_UI_RESOURCE_URI);
    expect(tools[0][1]._meta["openai/outputTemplate"]).toBe(SPORTFOLIO_SHARED_UI_RESOURCE_URI);
  });
});
