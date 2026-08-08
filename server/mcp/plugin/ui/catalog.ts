import {
  buildPluginPresentationCatalog,
  SPORTFOLIO_UI_RESOURCE_URIS,
} from "./surface";

export type PluginPresentationCatalogEntry = ReturnType<
  typeof buildPluginPresentationCatalog
>[number];

export function buildAllPluginPresentationCatalog(): PluginPresentationCatalogEntry[] {
  return [...buildPluginPresentationCatalog()];
}

export function getAllPluginUiResourceUris(): string[] {
  return Object.values(SPORTFOLIO_UI_RESOURCE_URIS);
}

export { SPORTFOLIO_UI_RESOURCE_URIS };
