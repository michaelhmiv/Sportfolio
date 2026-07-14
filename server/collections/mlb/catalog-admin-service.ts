import type { MlbCollectionSource } from "./catalog-importer";
import { catalogConfirmationSha256, previewInitialMlbCatalog } from "./catalog-preview";
import {
  createFinalCorrectionVersion,
  disableCollectionDefinition,
  finalizeTrackingCollection,
  getCollectionParticipation,
  inspectMlbCatalog,
  refreshTrackingCollection,
} from "./catalog-lifecycle-repository";
import { publishInitialMlbCatalog } from "./catalog-repository";
import { INITIAL_MLB_CATALOG } from "./initial-catalog";
import { mlbStatsApiCollectionSource } from "./statsapi-source";
import { resolveImportedMembers } from "./player-resolution-repository";
import type { CatalogPreviewDependencies } from "./catalog-preview";
import type { CollectionBackendService, CollectionEventPublisher } from "../service";
import { collectionEventPublisher, collectionService } from "../runtime";

export interface MlbCatalogAdminDependencies {
  source: MlbCollectionSource;
  resolveMembers: CatalogPreviewDependencies["resolveMembers"];
  collections: Pick<
    CollectionBackendService,
    "reconcile" | "reconcileCandidates" | "reconcileCandidatesInTransaction"
  >;
  publisher: CollectionEventPublisher;
}

function findPreview(previews: Awaited<ReturnType<typeof previewInitialMlbCatalog>>, slug: string) {
  const preview = previews.find((item) => item.definition.slug === slug);
  if (!preview) throw new Error(`Unknown MLB catalog definition ${slug}`);
  return preview;
}

export function createMlbCatalogAdminService(
  dependencies: MlbCatalogAdminDependencies = {
    source: mlbStatsApiCollectionSource,
    resolveMembers: resolveImportedMembers,
    collections: collectionService,
    publisher: collectionEventPublisher,
  },
) {
  const preview = async (slug?: string) => {
    const definitions = slug
      ? INITIAL_MLB_CATALOG.filter((definition) => definition.slug === slug)
      : INITIAL_MLB_CATALOG;
    if (slug && definitions.length === 0) throw new Error(`Unknown MLB catalog definition ${slug}`);
    return previewInitialMlbCatalog(
      { source: dependencies.source, resolveMembers: dependencies.resolveMembers },
      definitions,
    );
  };

  const publishCommittedEvents = async (
    events: Parameters<CollectionEventPublisher["publish"]>[0][],
  ) => {
    for (const event of events) {
      try {
        await dependencies.publisher.publish(event);
      } catch {
        // The event is durably committed; websocket delivery is best-effort.
      }
    }
  };

  return {
    preview,
    async inspect() {
      return inspectMlbCatalog();
    },
    async participation(slug: string) {
      return getCollectionParticipation(slug);
    },
    async publishInitial(actorUserId: string, expectedCatalogSha256: string) {
      const previews = await preview();
      if (catalogConfirmationSha256(previews) !== expectedCatalogSha256) {
        throw new Error("Initial MLB catalog no longer matches the confirmed preview manifest");
      }
      return publishInitialMlbCatalog(previews, actorUserId);
    },
    async refresh(slug: string, expectedSourceSha256: string) {
      const selected = findPreview(await preview(slug), slug);
      if (!selected.ok) throw new Error(`Cannot refresh failed preview ${slug}`);
      if (selected.sourceSnapshot.sha256 !== expectedSourceSha256) {
        throw new Error(
          `Collection ${slug} source snapshot no longer matches the confirmed preview`,
        );
      }
      const refreshed = await refreshTrackingCollection(selected, dependencies.collections);
      await publishCommittedEvents(refreshed.committedEvents);
      const { committedEvents, ...result } = refreshed;
      return { ...result, membershipEvents: committedEvents.length };
    },
    async finalize(slug: string, expectedSourceSha256: string) {
      const selected = findPreview(await preview(slug), slug);
      if (!selected.ok) throw new Error(`Cannot finalize failed preview ${slug}`);
      if (selected.sourceSnapshot.sha256 !== expectedSourceSha256) {
        throw new Error(
          `Collection ${slug} source snapshot no longer matches the confirmed preview`,
        );
      }
      const finalization = await finalizeTrackingCollection(selected, dependencies.collections);
      await publishCommittedEvents(finalization.committedEvents);
      const { committedEvents, ...result } = finalization;
      return { ...result, membershipEvents: committedEvents.length };
    },
    async correct(
      slug: string,
      actorUserId: string,
      expectedSourceSha256: string,
      correctionReason: string,
    ) {
      const selected = findPreview(await preview(slug), slug);
      if (!selected.ok) throw new Error(`Cannot correct from failed preview ${slug}`);
      if (selected.sourceSnapshot.sha256 !== expectedSourceSha256) {
        throw new Error(
          `Collection ${slug} source snapshot no longer matches the confirmed preview`,
        );
      }
      const correction = await createFinalCorrectionVersion(
        selected,
        actorUserId,
        correctionReason,
        dependencies.collections,
      );
      await publishCommittedEvents(correction.committedEvents);
      const { committedEvents, ...result } = correction;
      return { ...result, membershipEvents: committedEvents.length };
    },
    async reconcile(limit: number) {
      return dependencies.collections.reconcile(limit);
    },
    async disable(
      slug: string,
      reason: string,
      expectedVersion: number,
      expectedSourceSha256: string,
    ) {
      const disabled = await disableCollectionDefinition(
        slug,
        reason,
        expectedVersion,
        expectedSourceSha256,
        dependencies.collections,
      );
      await publishCommittedEvents(disabled.committedEvents);
      const { committedEvents, ...result } = disabled;
      return { ...result, membershipEvents: committedEvents.length };
    },
  };
}

export const mlbCatalogAdminService = createMlbCatalogAdminService();
