import { describe, expect, it, vi } from "vitest";
import {
  registerSharedPluginUiResource,
  SPORTFOLIO_SHARED_UI_RESOURCE_URI,
  SPORTFOLIO_UI_MIME_TYPE,
  SPORTFOLIO_WIDGET_ASSET_ORIGIN,
} from "./shared-resource";

describe("shared Sportfolio plugin UI resource", () => {
  it("registers one canonical resource without mutating MCP registration methods", async () => {
    const resources: any[][] = [];
    const registerResource = vi.fn((...args: any[]) => resources.push(args));
    const registerTool = vi.fn();
    const server = { registerResource, registerTool } as any;

    registerSharedPluginUiResource(server);

    expect(server.registerResource).toBe(registerResource);
    expect(server.registerTool).toBe(registerTool);
    expect(resources).toHaveLength(1);
    expect(resources[0][1]).toBe(SPORTFOLIO_SHARED_UI_RESOURCE_URI);
    expect(resources[0][2]).toMatchObject({ mimeType: SPORTFOLIO_UI_MIME_TYPE });

    const result = await resources[0][3]();
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toMatchObject({
      uri: SPORTFOLIO_SHARED_UI_RESOURCE_URI,
      mimeType: SPORTFOLIO_UI_MIME_TYPE,
      _meta: {
        ui: {
          domain: SPORTFOLIO_WIDGET_ASSET_ORIGIN,
          csp: { connectDomains: [], resourceDomains: [SPORTFOLIO_WIDGET_ASSET_ORIGIN] },
        },
      },
    });
  });
});
