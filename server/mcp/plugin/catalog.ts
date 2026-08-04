import {
  buildPluginStaticCatalog,
  type PluginMarketplaceCatalogEntry,
} from "./registry";

export type PluginCatalogEntry = PluginMarketplaceCatalogEntry & {
  annotations: {
    readOnlyHint: boolean;
    openWorldHint: boolean;
    destructiveHint: boolean;
  };
};

export function buildPluginCatalog(): PluginCatalogEntry[] {
  return buildPluginStaticCatalog().map((tool) => ({
    ...tool,
    annotations: {
      readOnlyHint: tool.readOnly,
      openWorldHint: tool.openWorld,
      destructiveHint: tool.destructive,
    },
  }));
}
