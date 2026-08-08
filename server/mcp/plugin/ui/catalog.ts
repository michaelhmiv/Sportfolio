import {
  buildSportsPluginPresentationCatalog,
  SPORTFOLIO_SPORTS_UI_RESOURCE_URIS,
} from "./sports-surface";
import {
  buildPluginPresentationCatalog,
  SPORTFOLIO_UI_RESOURCE_URIS,
} from "./surface";

export type PluginPresentationCatalogEntry =
  | ReturnType<typeof buildPluginPresentationCatalog>[number]
  | ReturnType<typeof buildSportsPluginPresentationCatalog>[number];

export function buildAllPluginPresentationCatalog(): PluginPresentationCatalogEntry[] {
  return [...buildPluginPresentationCatalog(), ...buildSportsPluginPresentationCatalog()];
}

export function getAllPluginUiResourceUris(): string[] {
  return [
    ...Object.values(SPORTFOLIO_UI_RESOURCE_URIS),
    ...Object.values(SPORTFOLIO_SPORTS_UI_RESOURCE_URIS),
  ];
}

export { SPORTFOLIO_SPORTS_UI_RESOURCE_URIS, SPORTFOLIO_UI_RESOURCE_URIS };
