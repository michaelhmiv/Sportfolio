export type MlbStatsGroup = "hitting" | "pitching";
export type MlbStatDirection = "asc" | "desc";

export interface MlbSeasonStatSplit {
  season: string;
  player: { id: number; fullName: string };
  rank?: number;
  stat: Record<string, number | string | null | undefined>;
  team?: { id: number; name: string };
  position?: { abbreviation?: string; name?: string };
}

export interface MlbAwardRecipient {
  awardId: string;
  player: { id: number; fullName: string };
  position?: string;
  teamId?: number;
  awardDate?: string;
}

export interface FetchSeasonStatsInput {
  season: number;
  group: MlbStatsGroup;
  sortStat: string;
  qualified?: boolean;
  gameType?: "R" | "P";
  limit: number;
}

export interface MlbCollectionSource {
  fetchSeasonStats(input: FetchSeasonStatsInput): Promise<MlbSeasonStatSplit[]>;
  fetchAwardRecipients(awardId: string, season: number): Promise<MlbAwardRecipient[]>;
}

interface BaseSeasonRule {
  season: number;
  group: MlbStatsGroup;
  statKey: string;
  sortStat: string;
  direction: MlbStatDirection;
  qualified?: boolean;
  gameType?: "R" | "P";
}

export type MlbCollectionRule =
  | (BaseSeasonRule & { type: "season_rank"; top: number })
  | (BaseSeasonRule & { type: "threshold"; minimum: number })
  | { type: "awards"; season: number; awardIds: string[] };

export interface ImportedCollectionMember {
  mlbamId: number;
  playerName: string;
  rank: number | null;
  statKey: string | null;
  qualificationValue: string | null;
  position: string | null;
  sourceMetadata: Record<string, unknown>;
}

function numericStat(split: MlbSeasonStatSplit, statKey: string): number {
  const value = split.stat[statKey];
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) {
    throw new Error(`MLB StatsAPI returned non-numeric ${statKey} for player ${split.player.id}`);
  }
  return numeric;
}

function compareValues(
  a: { value: number; split: MlbSeasonStatSplit },
  b: { value: number; split: MlbSeasonStatSplit },
  direction: MlbStatDirection,
): number {
  const primary = direction === "asc" ? a.value - b.value : b.value - a.value;
  return primary || a.split.player.id - b.split.player.id;
}

function seasonMember(
  split: MlbSeasonStatSplit,
  statKey: string,
  value: number,
  fallbackRank: number,
): ImportedCollectionMember {
  return {
    mlbamId: split.player.id,
    playerName: split.player.fullName,
    rank: split.rank ?? fallbackRank,
    statKey,
    qualificationValue: String(value),
    position: split.position?.abbreviation || split.position?.name || null,
    sourceMetadata: {
      season: split.season,
      teamId: split.team?.id ?? null,
      teamName: split.team?.name ?? null,
    },
  };
}

async function importSeasonRule(
  rule: Extract<MlbCollectionRule, BaseSeasonRule>,
  source: MlbCollectionSource,
): Promise<ImportedCollectionMember[]> {
  const splits = await source.fetchSeasonStats({
    season: rule.season,
    group: rule.group,
    sortStat: rule.sortStat,
    qualified: rule.qualified,
    gameType: rule.gameType,
    limit: 1000,
  });
  const ranked = splits
    .map((split) => ({ split, value: numericStat(split, rule.statKey) }))
    .sort((a, b) => compareValues(a, b, rule.direction));

  if (rule.type === "season_rank") {
    if (!Number.isSafeInteger(rule.top) || rule.top <= 0) {
      throw new Error("Top-N MLB collection rules require a positive integer cutoff");
    }
    const cutoff = ranked[Math.min(rule.top, ranked.length) - 1]?.value;
    if (cutoff === undefined) return [];
    return ranked
      .filter(({ value }) => (rule.direction === "asc" ? value <= cutoff : value >= cutoff))
      .map(({ split, value }, index) => seasonMember(split, rule.statKey, value, index + 1));
  }

  if (!Number.isFinite(rule.minimum)) {
    throw new Error("MLB threshold collection rules require a finite minimum");
  }
  return ranked
    .filter(({ value }) => value >= rule.minimum)
    .map(({ split, value }, index) => seasonMember(split, rule.statKey, value, index + 1));
}

async function importAwardsRule(
  rule: Extract<MlbCollectionRule, { type: "awards" }>,
  source: MlbCollectionSource,
): Promise<ImportedCollectionMember[]> {
  if (rule.awardIds.length === 0) {
    throw new Error("MLB award collection rules require at least one award ID");
  }
  const byPlayer = new Map<number, ImportedCollectionMember>();
  for (const awardId of rule.awardIds) {
    const recipients = await source.fetchAwardRecipients(awardId, rule.season);
    for (const recipient of recipients) {
      const current = byPlayer.get(recipient.player.id);
      const awardIds = current
        ? [...((current.sourceMetadata.awardIds as string[]) || []), awardId]
        : [awardId];
      byPlayer.set(recipient.player.id, {
        mlbamId: recipient.player.id,
        playerName: recipient.player.fullName,
        rank: null,
        statKey: null,
        qualificationValue: null,
        position: recipient.position || current?.position || null,
        sourceMetadata: {
          season: rule.season,
          awardIds: Array.from(new Set(awardIds)),
          teamId: recipient.teamId ?? current?.sourceMetadata.teamId ?? null,
          awardDate: recipient.awardDate ?? current?.sourceMetadata.awardDate ?? null,
        },
      });
    }
  }
  return Array.from(byPlayer.values()).sort((a, b) => a.mlbamId - b.mlbamId);
}

export async function importCollectionMembers(
  rule: MlbCollectionRule,
  source: MlbCollectionSource,
): Promise<ImportedCollectionMember[]> {
  return rule.type === "awards" ? importAwardsRule(rule, source) : importSeasonRule(rule, source);
}
