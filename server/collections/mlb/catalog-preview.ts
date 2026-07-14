import { createHash } from "node:crypto";
import {
  importCollectionMembers,
  type ImportedCollectionMember,
  type MlbCollectionSource,
} from "./catalog-importer";
import type { MlbCatalogDefinition } from "./initial-catalog";
import type { PlayerResolutionError, ResolvedCollectionMember } from "./player-resolver";

export interface CatalogPreviewError {
  code: PlayerResolutionError["code"] | "SOURCE_COUNT_MISMATCH" | "DUPLICATE_PLAYER";
  message: string;
  mlbamId?: number;
  playerName?: string;
}

export interface MlbCatalogPreview {
  ok: boolean;
  definition: MlbCatalogDefinition;
  members: ResolvedCollectionMember[];
  errors: CatalogPreviewError[];
  sourceSnapshot: {
    importedAt: string;
    memberCount: number;
    sha256: string;
    prerequisiteVersions?: Array<{ slug: string; version: number }>;
  };
}

export interface CatalogPreviewDependencies {
  source: MlbCollectionSource;
  resolveMembers(members: ImportedCollectionMember[]): Promise<{
    members: ResolvedCollectionMember[];
    errors: PlayerResolutionError[];
  }>;
  now?: () => Date;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function initialDefinitionManifest(preview: MlbCatalogPreview): Record<string, unknown> {
  const { definition, sourceSnapshot } = preview;
  return {
    definition: {
      slug: definition.slug,
      season: definition.season,
      family: definition.family,
      kind: definition.kind,
      sport: definition.sport,
      league: definition.league,
      lifecycle: definition.lifecycle,
      currentVersion: 1,
    },
    version: {
      state: definition.lifecycle === "tracking" ? "tracking" : "final",
      title: definition.title,
      description: definition.description,
      qualificationDescription: definition.description,
      qualificationRules:
        definition.kind === "player_slots"
          ? definition.rule
          : { prerequisiteSlugs: definition.prerequisiteSlugs },
      sourceType:
        definition.kind === "player_slots" ? "mlb_statsapi" : "collection_prerequisites",
      sourceUri: definition.kind === "player_slots" ? "https://statsapi.mlb.com/api/v1" : null,
      sourceMetadata: sourceSnapshot,
      points: definition.points,
      artKey: definition.slug,
    },
    slots:
      definition.kind === "player_slots"
        ? preview.members.map((member, index) => ({
            playerId: member.playerId,
            slotKey: `mlbam:${member.mlbamId}`,
            slotLabel: member.playerName,
            requiredQuantity: definition.slotQuantity.toFixed(4),
            isRequired: true,
            status: "active",
            rank: member.rank,
            statKey: member.statKey,
            qualificationValue:
              member.qualificationValue === null
                ? null
                : Number(member.qualificationValue).toFixed(6),
            qualificationMetadata: {
              mlbamId: member.mlbamId,
              position: member.position,
              ...member.sourceMetadata,
            },
            displayOrder: index,
          }))
        : [],
    prerequisites:
      definition.kind === "master"
        ? definition.prerequisiteSlugs.map((slug, index) => ({
            slug,
            version:
              sourceSnapshot.prerequisiteVersions?.find((item) => item.slug === slug)?.version ?? 1,
            isRequired: true,
            displayOrder: index,
          }))
        : [],
  };
}

export function initialDefinitionManifestSha256(preview: MlbCatalogPreview): string {
  return canonicalSha256(initialDefinitionManifest(preview));
}

function snapshotSha256(
  definition: MlbCatalogDefinition,
  members: ResolvedCollectionMember[],
  prerequisiteVersions: Array<{ slug: string; version: number }> = [],
): string {
  const payload = JSON.stringify({
    definition: {
      slug: definition.slug,
      sport: definition.sport,
      league: definition.league,
      season: definition.season,
      family: definition.family,
      lifecycle: definition.lifecycle,
      kind: definition.kind,
      title: definition.title,
      description: definition.description,
      points: definition.points,
      membership:
        definition.kind === "player_slots"
          ? {
              rule: definition.rule,
              slotQuantity: definition.slotQuantity.toFixed(4),
              expectedMemberCount: definition.expectedMemberCount ?? null,
            }
          : { prerequisiteSlugs: definition.prerequisiteSlugs },
    },
    members,
    prerequisiteVersions,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function snapshot(
  definition: MlbCatalogDefinition,
  members: ResolvedCollectionMember[],
  importedAt: Date,
): MlbCatalogPreview["sourceSnapshot"] {
  const prerequisiteVersions =
    definition.kind === "master"
      ? definition.prerequisiteSlugs.map((slug) => ({ slug, version: 1 }))
      : undefined;
  return {
    importedAt: importedAt.toISOString(),
    memberCount: members.length,
    sha256: snapshotSha256(definition, members, prerequisiteVersions),
    ...(prerequisiteVersions ? { prerequisiteVersions } : {}),
  };
}

export function bindMasterPrerequisiteVersions(
  preview: MlbCatalogPreview,
  prerequisiteVersions: Array<{ slug: string; version: number }>,
): MlbCatalogPreview {
  if (preview.definition.kind !== "master") return preview;
  return {
    ...preview,
    sourceSnapshot: {
      ...preview.sourceSnapshot,
      prerequisiteVersions,
      sha256: snapshotSha256(preview.definition, preview.members, prerequisiteVersions),
    },
  };
}

export async function previewMlbCatalogDefinition(
  definition: MlbCatalogDefinition,
  dependencies: CatalogPreviewDependencies,
): Promise<MlbCatalogPreview> {
  const importedAt = dependencies.now?.() || new Date();
  if (definition.kind === "master") {
    return {
      ok: true,
      definition,
      members: [],
      errors: [],
      sourceSnapshot: snapshot(definition, [], importedAt),
    };
  }

  const imported = await importCollectionMembers(definition.rule, dependencies.source);
  const resolved = await dependencies.resolveMembers(imported);
  const errors: CatalogPreviewError[] = [...resolved.errors];

  if (
    definition.expectedMemberCount !== undefined &&
    imported.length !== definition.expectedMemberCount
  ) {
    errors.push({
      code: "SOURCE_COUNT_MISMATCH",
      message: `${definition.slug} imported ${imported.length} members; expected exactly ${definition.expectedMemberCount}`,
    });
  } else if (definition.rule.type === "season_rank" && imported.length < definition.rule.top) {
    errors.push({
      code: "SOURCE_COUNT_MISMATCH",
      message: `${definition.slug} imported ${imported.length} members; expected at least ${definition.rule.top}`,
    });
  } else if (imported.length === 0) {
    errors.push({
      code: "SOURCE_COUNT_MISMATCH",
      message: `${definition.slug} imported no members`,
    });
  }

  if (resolved.members.length !== imported.length && resolved.errors.length === 0) {
    errors.push({
      code: "SOURCE_COUNT_MISMATCH",
      message: `${definition.slug} resolved ${resolved.members.length} of ${imported.length} members`,
    });
  }

  const playerIds = new Set<string>();
  for (const member of resolved.members) {
    if (playerIds.has(member.playerId)) {
      errors.push({
        code: "DUPLICATE_PLAYER",
        mlbamId: member.mlbamId,
        playerName: member.playerName,
        message: `${definition.slug} resolved multiple source members to ${member.playerId}`,
      });
    }
    playerIds.add(member.playerId);
  }

  return {
    ok: errors.length === 0,
    definition,
    members: resolved.members,
    errors,
    sourceSnapshot: snapshot(definition, resolved.members, importedAt),
  };
}

export function catalogConfirmationSha256(previews: MlbCatalogPreview[]): string {
  const manifest = previews
    .map((preview) => ({ slug: preview.definition.slug, sha256: preview.sourceSnapshot.sha256 }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export async function previewInitialMlbCatalog(
  dependencies: CatalogPreviewDependencies,
  definitions: MlbCatalogDefinition[],
): Promise<MlbCatalogPreview[]> {
  const previews: MlbCatalogPreview[] = [];
  for (const definition of definitions) {
    previews.push(await previewMlbCatalogDefinition(definition, dependencies));
  }
  return previews;
}
