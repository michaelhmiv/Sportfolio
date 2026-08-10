import {
  buildActionPluginPresentationCatalog,
  SPORTFOLIO_ACTION_UI_RESOURCE_URI,
} from "./action-surface";
import {
  buildGameplayPluginPresentationCatalog,
  SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS,
} from "./gameplay-surface";
import {
  buildOverviewPluginPresentationCatalog,
  SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS,
} from "./overview-surface";
import { SPORTFOLIO_SHARED_UI_RESOURCE_URI } from "./shared-resource";
import {
  buildSportsPluginPresentationCatalog,
  SPORTFOLIO_SPORTS_UI_RESOURCE_URIS,
} from "./sports-surface";
import { buildPluginPresentationCatalog, SPORTFOLIO_UI_RESOURCE_URIS } from "./surface";

export type PluginPresentationCatalogEntry =
  | ReturnType<typeof buildPluginPresentationCatalog>[number]
  | ReturnType<typeof buildSportsPluginPresentationCatalog>[number]
  | ReturnType<typeof buildActionPluginPresentationCatalog>[number]
  | ReturnType<typeof buildGameplayPluginPresentationCatalog>[number]
  | ReturnType<typeof buildOverviewPluginPresentationCatalog>[number];

export function buildAllPluginPresentationCatalog(): PluginPresentationCatalogEntry[] {
  return [
    ...buildPluginPresentationCatalog(),
    ...buildSportsPluginPresentationCatalog(),
    ...buildActionPluginPresentationCatalog(),
    ...buildGameplayPluginPresentationCatalog(),
    ...buildOverviewPluginPresentationCatalog(),
  ].map((entry) => ({
    ...entry,
    resourceUri: SPORTFOLIO_SHARED_UI_RESOURCE_URI,
  }));
}

export function getAllPluginUiResourceUris(): string[] {
  return [SPORTFOLIO_SHARED_UI_RESOURCE_URI];
}

export {
  SPORTFOLIO_ACTION_UI_RESOURCE_URI,
  SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS,
  SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS,
  SPORTFOLIO_SHARED_UI_RESOURCE_URI,
  SPORTFOLIO_SPORTS_UI_RESOURCE_URIS,
  SPORTFOLIO_UI_RESOURCE_URIS,
};
