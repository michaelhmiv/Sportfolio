import {
  buildActionPluginPresentationCatalog,
  SPORTFOLIO_ACTION_UI_RESOURCE_URI,
} from "./action-surface";
import {
  buildSportsPluginPresentationCatalog,
  SPORTFOLIO_SPORTS_UI_RESOURCE_URIS,
} from "./sports-surface";
import { buildPluginPresentationCatalog, SPORTFOLIO_UI_RESOURCE_URIS } from "./surface";

export type PluginPresentationCatalogEntry =
  | ReturnType<typeof buildPluginPresentationCatalog>[number]
  | ReturnType<typeof buildSportsPluginPresentationCatalog>[number]
  | ReturnType<typeof buildActionPluginPresentationCatalog>[number];

export function buildAllPluginPresentationCatalog(): PluginPresentationCatalogEntry[] {
  return [
    ...buildPluginPresentationCatalog(),
    ...buildSportsPluginPresentationCatalog(),
    ...buildActionPluginPresentationCatalog(),
  ];
}

export function getAllPluginUiResourceUris(): string[] {
  return [
    ...Object.values(SPORTFOLIO_UI_RESOURCE_URIS),
    ...Object.values(SPORTFOLIO_SPORTS_UI_RESOURCE_URIS),
    SPORTFOLIO_ACTION_UI_RESOURCE_URI,
  ];
}

export {
  SPORTFOLIO_ACTION_UI_RESOURCE_URI,
  SPORTFOLIO_SPORTS_UI_RESOURCE_URIS,
  SPORTFOLIO_UI_RESOURCE_URIS,
};
