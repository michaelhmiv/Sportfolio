import { isDeepStrictEqual } from "node:util";
import type { MlbCollectionSource } from "./catalog-importer";
import {
  canonicalSha256,
  catalogConfirmationSha256,
  previewInitialMlbCatalog,
} from "./catalog-preview";
import {
  bindCurrentMasterPrerequisiteVersions,
  createFinalCorrectionVersion,
  disableCollectionDefinition,
  finalizeTrackingCollection,
  getCollectionParticipation,
  inspectMlbCatalog,
  inspectMlbCatalogForInitialRetry,
  refreshTrackingCollection,
} from "./catalog-lifecycle-repository";
import {
  publishInitialMlbCatalog,
  type InitialCatalogPublicationResult,
} from "./catalog-repository";
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

function sourceMetadataCatalogSha256(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).initialCatalogSha256;
  return typeof value === "string" ? value : null;
}

function persistedInitialDefinitionManifestMatches(
  row: Record<string, unknown>,
  metadata: Record<string, unknown> | null,
): boolean {
  if (!metadata) return false;
  const expected = metadata.initialDefinitionManifestSha256;
  if (typeof expected !== "string") return false;
  const {
    initialCatalogSha256: _catalogSha256,
    initialDefinitionManifestSha256: _manifestSha256,
    ...sourceMetadata
  } = metadata;
  return (
    canonicalSha256({
      definition: {
        slug: row.slug,
        season: String(row.season),
        family: row.family,
        kind: row.kind,
        sport: row.sport,
        league: row.league,
        lifecycle: row.lifecycle_status,
        currentVersion: Number(row.current_version),
      },
      version: {
        state: row.version_state,
        title: row.title,
        description: row.description,
        qualificationDescription: row.qualification_description,
        qualificationRules: row.qualification_rules,
        sourceType: row.source_type,
        sourceUri: row.source_uri,
        sourceMetadata,
        artKey: row.art_key,
      },
      slots: row.manifest_slots,
      prerequisites: row.manifest_prerequisites,
    }) === expected
  );
}

export function existingInitialPublication(
  rows: unknown[],
  expectedCatalogSha256: string,
): InitialCatalogPublicationResult | null {
  const expectedBySlug = new Map(
    INITIAL_MLB_CATALOG.map((definition) => [definition.slug, definition]),
  );
  const selected = rows.filter(
    (row): row is Record<string, unknown> =>
      !!row &&
      typeof row === "object" &&
      expectedBySlug.has(String((row as Record<string, unknown>).slug)),
  );
  if (selected.length === 0) return null;
  if (selected.length !== INITIAL_MLB_CATALOG.length) {
    throw new Error(
      "Refusing partial initial MLB catalog publication; current versions are incomplete",
    );
  }
  let slotCount = 0;
  let prerequisiteCount = 0;
  for (const row of selected) {
    const definition = expectedBySlug.get(String(row.slug))!;
    const metadata = row.source_metadata as Record<string, unknown> | null;
    const memberCount = Number(metadata?.memberCount ?? 0);
    const activeSlotCount = Number(row.active_slot_count ?? 0);
    const actualPrerequisites = Number(row.prerequisite_count ?? 0);
    const expectedPrerequisites =
      definition.kind === "master" ? definition.prerequisiteSlugs.length : 0;
    if (
      Number(row.current_version) !== 1 ||
      String(row.season) !== definition.season ||
      row.family !== definition.family ||
      row.kind !== definition.kind ||
      row.sport !== definition.sport ||
      row.league !== definition.league ||
      row.lifecycle_status !== definition.lifecycle ||
      row.version_state !== (definition.lifecycle === "tracking" ? "tracking" : "final") ||
      row.title !== definition.title ||
      row.description !== definition.description ||
      row.qualification_description !== definition.description ||
      !isDeepStrictEqual(
        row.qualification_rules,
        definition.kind === "player_slots"
          ? definition.rule
          : { prerequisiteSlugs: definition.prerequisiteSlugs },
      ) ||
      row.source_type !==
        (definition.kind === "player_slots" ? "mlb_statsapi" : "collection_prerequisites") ||
      row.source_uri !==
        (definition.kind === "player_slots" ? "https://statsapi.mlb.com/api/v1" : null) ||
      row.art_key !== definition.slug ||
      sourceMetadataCatalogSha256(metadata) !== expectedCatalogSha256 ||
      !persistedInitialDefinitionManifestMatches(row, metadata) ||
      activeSlotCount !== memberCount ||
      actualPrerequisites !== expectedPrerequisites
    ) {
      throw new Error(
        `Refusing initial MLB catalog retry; ${definition.slug} does not match the confirmed persisted manifest`,
      );
    }
    slotCount += activeSlotCount;
    prerequisiteCount += actualPrerequisites;
  }
  return {
    status: "already_published",
    definitionCount: selected.length,
    versionCount: selected.length,
    slotCount,
    prerequisiteCount,
  };
}

export function createMlbCatalogAdminService(
  dependencies: MlbCatalogAdminDependencies = {
    source: mlbStatsApiCollectionSource,
    resolveMembers: (members) => resolveImportedMembers(members, false),
    collections: collectionService,
    publisher: collectionEventPublisher,
  },
) {
  const preview = async (slug?: string) => {
    const definitions = slug
      ? INITIAL_MLB_CATALOG.filter((definition) => definition.slug === slug)
      : INITIAL_MLB_CATALOG;
    if (slug && definitions.length === 0) throw new Error(`Unknown MLB catalog definition ${slug}`);
    return bindCurrentMasterPrerequisiteVersions(
      await previewInitialMlbCatalog(
        { source: dependencies.source, resolveMembers: dependencies.resolveMembers },
        definitions,
      ),
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
      const existing = existingInitialPublication(
        await inspectMlbCatalogForInitialRetry(),
        expectedCatalogSha256,
      );
      if (existing) return existing;
      const previews = await preview();
      if (catalogConfirmationSha256(previews) !== expectedCatalogSha256) {
        const concurrentlyPublished = existingInitialPublication(
          await inspectMlbCatalogForInitialRetry(),
          expectedCatalogSha256,
        );
        if (concurrentlyPublished) return concurrentlyPublished;
        throw new Error("MLB catalog source snapshot changed after preview confirmation");
      }
      return publishInitialMlbCatalog(previews, actorUserId, expectedCatalogSha256);
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
