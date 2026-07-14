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

function snapshot(
  definition: MlbCatalogDefinition,
  members: ResolvedCollectionMember[],
  importedAt: Date,
): MlbCatalogPreview["sourceSnapshot"] {
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
  });
  return {
    importedAt: importedAt.toISOString(),
    memberCount: members.length,
    sha256: createHash("sha256").update(payload).digest("hex"),
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
