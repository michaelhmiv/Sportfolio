import { PLUGIN_TOOL_ADAPTERS } from "./adapters";
import { getPluginV1ToolPolicy } from "./capability-policy";

export type PluginCatalogEntry = {
  name: string;
  sourceTool: string;
  title: string;
  description: string;
  access: "public" | "oauth";
  dataClassification: string;
  annotations: {
    readOnlyHint: boolean;
    openWorldHint: boolean;
    destructiveHint: boolean;
  };
  securitySchemes: Array<{ type: "noauth" } | { type: "oauth2"; scopes: string[] }>;
};

export function buildPluginCatalog(): PluginCatalogEntry[] {
  return PLUGIN_TOOL_ADAPTERS.map((adapter) => {
    const policy = getPluginV1ToolPolicy(adapter.name);
    if (!policy) throw new Error(`Missing plugin policy for ${adapter.name}`);
    return {
      name: adapter.name,
      sourceTool: adapter.sourceTool,
      title: adapter.title,
      description: adapter.description,
      access: policy.access,
      dataClassification: policy.dataClassification,
      annotations: {
        readOnlyHint: policy.readOnly,
        openWorldHint: policy.openWorld,
        destructiveHint: policy.destructive,
      },
      securitySchemes:
        policy.access === "public"
          ? [{ type: "noauth" as const }]
          : [{ type: "oauth2" as const, scopes: ["openid"] }],
    };
  });
}
