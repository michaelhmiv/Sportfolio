import { z } from "zod";
import { describe, expect, it } from "vitest";
import { registerPluginMarketplaceSurface } from "./registry";
import { registerActionPluginUiSurface } from "./ui/action-surface";
import { registerGameplayPluginUiSurface } from "./ui/gameplay-surface";
import { registerOverviewPluginUiSurface } from "./ui/overview-surface";
import { registerPluginUiSurface } from "./ui/surface";
import { registerSportsPluginUiSurface } from "./ui/sports-surface";
import { createMockPublicMcpDependencies } from "../testing";

type Registration = {
  name: string;
  config: Record<string, any>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

function fakeServer(registrations: Registration[]) {
  return {
    registerTool(name: string, config: Record<string, any>, handler: Registration["handler"]) {
      registrations.push({ name, config, handler });
      return undefined;
    },
    registerPrompt() {
      return undefined;
    },
    registerResource() {
      return undefined;
    },
  };
}

describe("full production ChatGPT MCP surface contracts", () => {
  it("enumerates every registered production tool and accepts its published fixture", async () => {
    const registrations: Registration[] = [];
    const server = fakeServer(registrations);
    const harness = createMockPublicMcpDependencies();
    const context = {
      auth: { userId: harness.userId },
    } as any;

    await registerPluginMarketplaceSurface(server as any, context, harness.deps);
    await registerPluginUiSurface(server as any, context);
    await registerSportsPluginUiSurface(server as any, context, harness.deps);
    await registerActionPluginUiSurface(server as any, context);
    await registerGameplayPluginUiSurface(server as any, context, harness.deps);
    await registerOverviewPluginUiSurface(server as any, context, harness.deps);

    const names = registrations.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(102);
    expect(names).not.toContain("stage_stack_shares");
    expect(names).not.toContain("get_holding_multiplier_state");

    const invalid: string[] = [];
    for (const registration of registrations) {
      const schema = registration.config.inputSchema || {};
      const fixtureArgs = registration.config._meta?.fixtureArgs || {};
      const parsed = z.object(schema).strict().safeParse(fixtureArgs);
      if (!parsed.success) {
        invalid.push(`${registration.name}: ${parsed.error.message}`);
      }
    }
    expect(invalid).toEqual([]);
  });

  it("keeps every render tool on the one canonical shared MCP App resource", async () => {
    const registrations: Registration[] = [];
    const server = fakeServer(registrations);
    const harness = createMockPublicMcpDependencies();
    const context = { auth: { userId: harness.userId } } as any;

    await registerPluginMarketplaceSurface(server as any, context, harness.deps);
    await registerPluginUiSurface(server as any, context);
    await registerSportsPluginUiSurface(server as any, context, harness.deps);
    await registerActionPluginUiSurface(server as any, context);
    await registerGameplayPluginUiSurface(server as any, context, harness.deps);
    await registerOverviewPluginUiSurface(server as any, context, harness.deps);

    const renderTools = registrations.filter((entry) => entry.name.startsWith("render_"));
    expect(renderTools).toHaveLength(15);
    const uris = new Set(renderTools.map((entry) => entry.config._meta?.ui?.resourceUri));
    expect(uris.size).toBe(1);
    expect([...uris][0]).toMatch(/^ui:\/\/sportfolio\/app\/[a-f0-9]{16}\.html$/);
  });
});
