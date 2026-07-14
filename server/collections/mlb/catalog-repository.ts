import {
  collectionDefinitions,
  collectionDefinitionVersions,
  collectionPrerequisites,
  collectionSlots,
} from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import type { MlbCatalogPreview } from "./catalog-preview";

export interface InitialCatalogPublicationResult {
  status: "published" | "already_published";
  definitionCount: number;
  versionCount: number;
  slotCount: number;
  prerequisiteCount: number;
}

function assertPublishable(previews: MlbCatalogPreview[]): void {
  if (previews.length === 0) throw new Error("MLB catalog publication requires previews");
  const failures = previews.filter((preview) => !preview.ok);
  if (failures.length > 0) {
    throw new Error(
      `MLB catalog preview failed: ${failures
        .map((preview) => `${preview.definition.slug} (${preview.errors.length} errors)`)
        .join(", ")}`,
    );
  }
  const slugs = previews.map((preview) => preview.definition.slug);
  if (new Set(slugs).size !== slugs.length) {
    throw new Error("MLB catalog publication contains duplicate slugs");
  }
}

type CatalogTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function snapshotSha256(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).sha256;
  return typeof value === "string" ? value : null;
}

export function existingSlotMatchesExpected(
  actual: {
    playerId: string | null;
    slotKey: string;
    requiredQuantity: string;
    isRequired: boolean;
    status: string;
  },
  expected: { playerId: string; slotKey: string; requiredQuantity: string },
): boolean {
  return (
    actual.playerId === expected.playerId &&
    actual.slotKey === expected.slotKey &&
    actual.requiredQuantity === expected.requiredQuantity &&
    actual.isRequired &&
    actual.status === "active"
  );
}

async function validateCompleteExistingCatalog(
  tx: CatalogTransaction,
  previews: MlbCatalogPreview[],
): Promise<Omit<InitialCatalogPublicationResult, "status">> {
  const slugs = previews.map((preview) => preview.definition.slug);
  const rows = await tx
    .select({
      definitionId: collectionDefinitions.id,
      slug: collectionDefinitions.slug,
      sport: collectionDefinitions.sport,
      league: collectionDefinitions.league,
      season: collectionDefinitions.season,
      family: collectionDefinitions.family,
      kind: collectionDefinitions.kind,
      lifecycleStatus: collectionDefinitions.lifecycleStatus,
      currentVersion: collectionDefinitions.currentVersion,
      versionId: collectionDefinitionVersions.id,
      version: collectionDefinitionVersions.version,
      versionState: collectionDefinitionVersions.state,
      sourceMetadata: collectionDefinitionVersions.sourceMetadata,
    })
    .from(collectionDefinitions)
    .innerJoin(
      collectionDefinitionVersions,
      and(
        eq(collectionDefinitionVersions.definitionId, collectionDefinitions.id),
        eq(collectionDefinitionVersions.version, collectionDefinitions.currentVersion),
      ),
    )
    .where(inArray(collectionDefinitions.slug, slugs));

  if (rows.length !== previews.length) {
    throw new Error(
      "Refusing partial initial MLB catalog publication; current versions are incomplete",
    );
  }
  const rowBySlug = new Map(rows.map((row) => [row.slug, row]));
  for (const preview of previews) {
    const expected = preview.definition;
    const actual = rowBySlug.get(expected.slug);
    const expectedState = expected.lifecycle;
    if (
      !actual ||
      actual.sport !== expected.sport ||
      actual.league !== expected.league ||
      actual.season !== expected.season ||
      actual.family !== expected.family ||
      actual.kind !== expected.kind ||
      actual.lifecycleStatus !== expectedState ||
      actual.currentVersion !== 1 ||
      actual.version !== 1 ||
      actual.versionState !== expectedState ||
      snapshotSha256(actual.sourceMetadata) !== preview.sourceSnapshot.sha256
    ) {
      throw new Error(
        `Refusing partial initial MLB catalog publication; ${expected.slug} does not match the confirmed manifest`,
      );
    }
  }

  const versionIds = rows.map((row) => row.versionId);
  const slotRows = await tx
    .select({
      versionId: collectionSlots.collectionVersionId,
      playerId: collectionSlots.playerId,
      slotKey: collectionSlots.slotKey,
      requiredQuantity: collectionSlots.requiredQuantity,
      isRequired: collectionSlots.isRequired,
      status: collectionSlots.status,
    })
    .from(collectionSlots)
    .where(inArray(collectionSlots.collectionVersionId, versionIds));
  const slotsByVersion = new Map<string, typeof slotRows>();
  for (const slot of slotRows) {
    const slots = slotsByVersion.get(slot.versionId) ?? [];
    slots.push(slot);
    slotsByVersion.set(slot.versionId, slots);
  }
  for (const preview of previews) {
    const actual = rowBySlug.get(preview.definition.slug)!;
    const slots = slotsByVersion.get(actual.versionId) ?? [];
    const expectedSlots = (() => {
      const definition = preview.definition;
      if (definition.kind !== "player_slots") return [];
      return preview.members.map((member) => ({
        slotKey: `mlbam:${member.mlbamId}`,
        playerId: member.playerId,
        requiredQuantity: definition.slotQuantity.toFixed(4),
      }));
    })();
    const actualByKey = new Map(slots.map((slot) => [slot.slotKey, slot]));
    if (
      slots.length !== expectedSlots.length ||
      expectedSlots.some((expected) => {
        const actualSlot = actualByKey.get(expected.slotKey);
        return !actualSlot || !existingSlotMatchesExpected(actualSlot, expected);
      })
    ) {
      throw new Error(
        `Refusing partial initial MLB catalog publication; ${preview.definition.slug} slot membership is incomplete`,
      );
    }
  }

  const prerequisiteRows = await tx
    .select({
      masterVersionId: collectionPrerequisites.masterVersionId,
      prerequisiteVersionId: collectionPrerequisites.prerequisiteVersionId,
      isRequired: collectionPrerequisites.isRequired,
    })
    .from(collectionPrerequisites)
    .where(inArray(collectionPrerequisites.masterVersionId, versionIds));
  const slugByVersionId = new Map(rows.map((row) => [row.versionId, row.slug]));
  const actualPrerequisites = new Set(
    prerequisiteRows.map(
      (row) =>
        `${slugByVersionId.get(row.masterVersionId)}:${slugByVersionId.get(row.prerequisiteVersionId)}:${row.isRequired}`,
    ),
  );
  const expectedPrerequisites = previews.flatMap((preview) =>
    preview.definition.kind === "master"
      ? preview.definition.prerequisiteSlugs.map(
          (prerequisite) => `${preview.definition.slug}:${prerequisite}:true`,
        )
      : [],
  );
  if (
    prerequisiteRows.length !== expectedPrerequisites.length ||
    expectedPrerequisites.some((key) => !actualPrerequisites.has(key))
  ) {
    throw new Error(
      "Refusing partial initial MLB catalog publication; prerequisite links are incomplete",
    );
  }

  return {
    definitionCount: rows.length,
    versionCount: rows.length,
    slotCount: slotRows.length,
    prerequisiteCount: prerequisiteRows.length,
  };
}

export async function publishInitialMlbCatalog(
  previews: MlbCatalogPreview[],
  actorUserId: string,
): Promise<InitialCatalogPublicationResult> {
  assertPublishable(previews);
  const slugs = previews.map((preview) => preview.definition.slug);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended('sportfolio_mlb_catalog_admin', 0))`,
    );
    const existing = await tx
      .select({ id: collectionDefinitions.id, slug: collectionDefinitions.slug })
      .from(collectionDefinitions)
      .where(inArray(collectionDefinitions.slug, slugs))
      .for("update");

    if (existing.length === previews.length) {
      const validated = await validateCompleteExistingCatalog(tx, previews);
      return {
        status: "already_published" as const,
        ...validated,
      };
    }
    if (existing.length > 0) {
      throw new Error(
        `Refusing partial initial MLB catalog publication; existing slugs: ${existing
          .map((row) => row.slug)
          .join(", ")}`,
      );
    }

    const insertedDefinitions = await tx
      .insert(collectionDefinitions)
      .values(
        previews.map(({ definition }) => ({
          slug: definition.slug,
          sport: definition.sport,
          league: definition.league,
          season: definition.season,
          family: definition.family,
          kind: definition.kind,
          lifecycleStatus: "draft",
          currentVersion: 1,
        })),
      )
      .returning({ id: collectionDefinitions.id, slug: collectionDefinitions.slug });
    const definitionIdBySlug = new Map(
      insertedDefinitions.map((definition) => [definition.slug, definition.id]),
    );

    const insertedVersions = await tx
      .insert(collectionDefinitionVersions)
      .values(
        previews.map((preview) => {
          const { definition, sourceSnapshot } = preview;
          return {
            definitionId: definitionIdBySlug.get(definition.slug)!,
            version: 1,
            title: definition.title,
            description: definition.description,
            qualificationDescription: definition.description,
            qualificationRules:
              definition.kind === "player_slots"
                ? definition.rule
                : { prerequisiteSlugs: definition.prerequisiteSlugs },
            sourceType:
              definition.kind === "player_slots" ? "mlb_statsapi" : "collection_prerequisites",
            sourceUri:
              definition.kind === "player_slots" ? "https://statsapi.mlb.com/api/v1" : null,
            sourceMetadata: sourceSnapshot,
            points: definition.points,
            artKey: definition.slug,
            state: "draft",
            createdBy: actorUserId,
          };
        }),
      )
      .returning({
        id: collectionDefinitionVersions.id,
        definitionId: collectionDefinitionVersions.definitionId,
      });
    const slugByDefinitionId = new Map(
      insertedDefinitions.map((definition) => [definition.id, definition.slug]),
    );
    const versionIdBySlug = new Map(
      insertedVersions.map((version) => [
        slugByDefinitionId.get(version.definitionId)!,
        version.id,
      ]),
    );

    const slotRows = previews.flatMap((preview) => {
      const definition = preview.definition;
      if (definition.kind !== "player_slots") return [];
      return preview.members.map((member, index) => ({
        collectionVersionId: versionIdBySlug.get(definition.slug)!,
        playerId: member.playerId,
        slotKey: `mlbam:${member.mlbamId}`,
        slotLabel: member.playerName,
        requiredQuantity: definition.slotQuantity.toFixed(4),
        isRequired: true,
        status: "active",
        rank: member.rank,
        statKey: member.statKey,
        qualificationValue: member.qualificationValue,
        qualificationMetadata: {
          mlbamId: member.mlbamId,
          position: member.position,
          ...member.sourceMetadata,
        },
        displayOrder: index,
      }));
    });
    if (slotRows.length > 0) await tx.insert(collectionSlots).values(slotRows);

    const prerequisiteRows = previews.flatMap((preview) => {
      if (preview.definition.kind !== "master") return [];
      return preview.definition.prerequisiteSlugs.map((prerequisiteSlug, index) => {
        const prerequisiteVersionId = versionIdBySlug.get(prerequisiteSlug);
        if (!prerequisiteVersionId) {
          throw new Error(
            `${preview.definition.slug} references missing prerequisite ${prerequisiteSlug}`,
          );
        }
        return {
          masterVersionId: versionIdBySlug.get(preview.definition.slug)!,
          prerequisiteVersionId,
          isRequired: true,
          displayOrder: index,
        };
      });
    });
    if (prerequisiteRows.length > 0) {
      await tx.insert(collectionPrerequisites).values(prerequisiteRows);
    }

    const now = new Date();
    const finalSlugs = previews
      .filter((preview) => preview.definition.lifecycle === "final")
      .map((preview) => preview.definition.slug);
    const trackingSlugs = previews
      .filter((preview) => preview.definition.lifecycle === "tracking")
      .map((preview) => preview.definition.slug);
    const finalVersionIds = finalSlugs.map((slug) => versionIdBySlug.get(slug)!);
    const trackingVersionIds = trackingSlugs.map((slug) => versionIdBySlug.get(slug)!);
    const finalDefinitionIds = finalSlugs.map((slug) => definitionIdBySlug.get(slug)!);
    const trackingDefinitionIds = trackingSlugs.map((slug) => definitionIdBySlug.get(slug)!);

    if (finalVersionIds.length > 0) {
      await tx
        .update(collectionDefinitionVersions)
        .set({
          state: "final",
          publishedAt: now,
          membershipLockedAt: now,
          finalizedAt: now,
          updatedAt: now,
        })
        .where(inArray(collectionDefinitionVersions.id, finalVersionIds));
    }
    if (trackingVersionIds.length > 0) {
      await tx
        .update(collectionDefinitionVersions)
        .set({ state: "tracking", publishedAt: now, updatedAt: now })
        .where(inArray(collectionDefinitionVersions.id, trackingVersionIds));
    }
    if (finalDefinitionIds.length > 0) {
      await tx
        .update(collectionDefinitions)
        .set({ lifecycleStatus: "final", publishedAt: now, finalizedAt: now, updatedAt: now })
        .where(inArray(collectionDefinitions.id, finalDefinitionIds));
    }
    if (trackingDefinitionIds.length > 0) {
      await tx
        .update(collectionDefinitions)
        .set({ lifecycleStatus: "tracking", publishedAt: now, updatedAt: now })
        .where(inArray(collectionDefinitions.id, trackingDefinitionIds));
    }

    return {
      status: "published" as const,
      definitionCount: insertedDefinitions.length,
      versionCount: insertedVersions.length,
      slotCount: slotRows.length,
      prerequisiteCount: prerequisiteRows.length,
    };
  });
}
