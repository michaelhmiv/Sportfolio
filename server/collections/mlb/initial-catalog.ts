import type { MlbCollectionRule } from "./catalog-importer";

export type MlbCollectionFamily =
  | "season_leaders"
  | "threshold_clubs"
  | "official_awards"
  | "official_teams"
  | "postseason"
  | "masters";

interface CatalogDefinitionBase {
  slug: string;
  title: string;
  description: string;
  sport: "MLB";
  league: "MLB";
  season: string;
  family: MlbCollectionFamily;
  lifecycle: "tracking" | "final";
}

export interface MlbPlayerCatalogDefinition extends CatalogDefinitionBase {
  kind: "player_slots";
  slotQuantity: number;
  expectedMemberCount?: number;
  rule: MlbCollectionRule;
}

export interface MlbMasterCatalogDefinition extends CatalogDefinitionBase {
  kind: "master";
  prerequisiteSlugs: string[];
}

export type MlbCatalogDefinition = MlbPlayerCatalogDefinition | MlbMasterCatalogDefinition;

const topRule = (
  season: number,
  group: "hitting" | "pitching",
  statKey: string,
  sortStat: string,
  options: { qualified?: boolean; direction?: "asc" | "desc"; gameType?: "R" | "P" } = {},
): MlbCollectionRule => ({
  type: "season_rank",
  season,
  group,
  statKey,
  sortStat,
  top: 10,
  direction: options.direction || "desc",
  qualified: options.qualified,
  gameType: options.gameType,
});

const finalPlayer = (
  input: Omit<MlbPlayerCatalogDefinition, "kind" | "sport" | "league" | "lifecycle">,
): MlbPlayerCatalogDefinition => ({
  ...input,
  kind: "player_slots",
  sport: "MLB",
  league: "MLB",
  lifecycle: "final",
});

const trackingPlayer = (
  input: Omit<MlbPlayerCatalogDefinition, "kind" | "sport" | "league" | "lifecycle">,
): MlbPlayerCatalogDefinition => ({
  ...input,
  kind: "player_slots",
  sport: "MLB",
  league: "MLB",
  lifecycle: "tracking",
});

export const INITIAL_MLB_CATALOG: MlbCatalogDefinition[] = [
  finalPlayer({
    slug: "2025-mlb-home-run-leaders",
    title: "2025 MLB Home Run Leaders",
    description: "The top ten 2025 MLB home run hitters, including ties at the cutoff.",
    season: "2025",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2025, "hitting", "homeRuns", "homeRuns"),
  }),
  finalPlayer({
    slug: "2025-mlb-rbi-leaders",
    title: "2025 MLB RBI Leaders",
    description: "The top ten 2025 MLB RBI hitters, including ties at the cutoff.",
    season: "2025",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2025, "hitting", "rbi", "runsBattedIn"),
  }),
  finalPlayer({
    slug: "2025-mlb-ops-leaders",
    title: "2025 MLB OPS Leaders",
    description: "The top ten officially qualified 2025 MLB hitters by OPS, including ties.",
    season: "2025",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2025, "hitting", "ops", "onBasePlusSlugging", { qualified: true }),
  }),
  finalPlayer({
    slug: "2025-mlb-stolen-base-leaders",
    title: "2025 MLB Stolen Base Leaders",
    description: "The top ten 2025 MLB stolen-base leaders, including ties at the cutoff.",
    season: "2025",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2025, "hitting", "stolenBases", "stolenBases"),
  }),
  finalPlayer({
    slug: "2025-mlb-strikeout-leaders",
    title: "2025 MLB Strikeout Leaders",
    description: "The top ten 2025 MLB pitchers by strikeouts, including ties at the cutoff.",
    season: "2025",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2025, "pitching", "strikeOuts", "strikeOuts"),
  }),
  finalPlayer({
    slug: "2025-mlb-era-leaders",
    title: "2025 MLB ERA Leaders",
    description:
      "The ten lowest ERAs among officially qualified 2025 MLB pitchers, including ties.",
    season: "2025",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2025, "pitching", "era", "earnedRunAverage", {
      qualified: true,
      direction: "asc",
    }),
  }),
  finalPlayer({
    slug: "2025-mlb-saves-leaders",
    title: "2025 MLB Saves Leaders",
    description: "The top ten 2025 MLB pitchers by saves, including ties at the cutoff.",
    season: "2025",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2025, "pitching", "saves", "saves"),
  }),
  finalPlayer({
    slug: "2025-mlb-30-home-run-club",
    title: "2025 MLB 30 Home Run Club",
    description: "Every MLB hitter with at least 30 home runs in 2025.",
    season: "2025",
    family: "threshold_clubs",
    slotQuantity: 20,
    expectedMemberCount: 33,
    rule: {
      type: "threshold",
      season: 2025,
      group: "hitting",
      statKey: "homeRuns",
      sortStat: "homeRuns",
      direction: "desc",
      minimum: 30,
    },
  }),
  finalPlayer({
    slug: "2025-mlb-100-rbi-club",
    title: "2025 MLB 100 RBI Club",
    description: "Every MLB hitter with at least 100 RBI in 2025.",
    season: "2025",
    family: "threshold_clubs",
    slotQuantity: 20,
    expectedMemberCount: 16,
    rule: {
      type: "threshold",
      season: 2025,
      group: "hitting",
      statKey: "rbi",
      sortStat: "runsBattedIn",
      direction: "desc",
      minimum: 100,
    },
  }),
  finalPlayer({
    slug: "2025-mlb-200-strikeout-club",
    title: "2025 MLB 200 Strikeout Club",
    description: "Every MLB pitcher with at least 200 strikeouts in 2025.",
    season: "2025",
    family: "threshold_clubs",
    slotQuantity: 20,
    expectedMemberCount: 12,
    rule: {
      type: "threshold",
      season: 2025,
      group: "pitching",
      statKey: "strikeOuts",
      sortStat: "strikeOuts",
      direction: "desc",
      minimum: 200,
    },
  }),
  finalPlayer({
    slug: "2025-mlb-silver-slugger-winners",
    title: "2025 MLB Silver Slugger Winners",
    description: "The official 2025 American and National League Silver Slugger recipients.",
    season: "2025",
    family: "official_awards",
    slotQuantity: 30,
    expectedMemberCount: 20,
    rule: { type: "awards", season: 2025, awardIds: ["ALSS", "NLSS"] },
  }),
  finalPlayer({
    slug: "2025-mlb-gold-glove-winners",
    title: "2025 MLB Gold Glove Winners",
    description: "The official 2025 American and National League Gold Glove recipients.",
    season: "2025",
    family: "official_awards",
    slotQuantity: 30,
    expectedMemberCount: 20,
    rule: { type: "awards", season: 2025, awardIds: ["ALGG", "NLGG"] },
  }),
  finalPlayer({
    slug: "2025-all-mlb-first-team",
    title: "2025 All-MLB First Team",
    description: "The official 2025 All-MLB First Team recipients.",
    season: "2025",
    family: "official_teams",
    slotQuantity: 30,
    expectedMemberCount: 16,
    rule: { type: "awards", season: 2025, awardIds: ["MLBAFIRST"] },
  }),
  finalPlayer({
    slug: "2025-mlb-postseason-home-run-leaders",
    title: "2025 MLB Postseason Home Run Leaders",
    description: "The top ten 2025 postseason home run hitters, including ties at the cutoff.",
    season: "2025",
    family: "postseason",
    slotQuantity: 35,
    rule: topRule(2025, "hitting", "homeRuns", "homeRuns", { gameType: "P" }),
  }),
  finalPlayer({
    slug: "2025-mlb-postseason-strikeout-leaders",
    title: "2025 MLB Postseason Strikeout Leaders",
    description: "The top ten 2025 postseason pitchers by strikeouts, including ties.",
    season: "2025",
    family: "postseason",
    slotQuantity: 35,
    rule: topRule(2025, "pitching", "strikeOuts", "strikeOuts", { gameType: "P" }),
  }),
  trackingPlayer({
    slug: "2026-mlb-home-run-leaders",
    title: "2026 MLB Home Run Leaders",
    description: "Live 2026 MLB home run leaders, updated while the season is tracking.",
    season: "2026",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2026, "hitting", "homeRuns", "homeRuns"),
  }),
  trackingPlayer({
    slug: "2026-mlb-rbi-leaders",
    title: "2026 MLB RBI Leaders",
    description: "Live 2026 MLB RBI leaders, updated while the season is tracking.",
    season: "2026",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2026, "hitting", "rbi", "runsBattedIn"),
  }),
  trackingPlayer({
    slug: "2026-mlb-stolen-base-leaders",
    title: "2026 MLB Stolen Base Leaders",
    description: "Live 2026 MLB stolen-base leaders, updated while the season is tracking.",
    season: "2026",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2026, "hitting", "stolenBases", "stolenBases"),
  }),
  trackingPlayer({
    slug: "2026-mlb-strikeout-leaders",
    title: "2026 MLB Strikeout Leaders",
    description: "Live 2026 MLB pitching strikeout leaders, updated while tracking.",
    season: "2026",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2026, "pitching", "strikeOuts", "strikeOuts"),
  }),
  trackingPlayer({
    slug: "2026-mlb-era-leaders",
    title: "2026 MLB ERA Leaders",
    description: "Live officially qualified 2026 MLB ERA leaders, updated while tracking.",
    season: "2026",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2026, "pitching", "era", "earnedRunAverage", {
      qualified: true,
      direction: "asc",
    }),
  }),
  trackingPlayer({
    slug: "2026-mlb-ops-leaders",
    title: "2026 MLB OPS Leaders",
    description: "Live officially qualified 2026 MLB OPS leaders, updated while tracking.",
    season: "2026",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2026, "hitting", "ops", "onBasePlusSlugging", { qualified: true }),
  }),
  trackingPlayer({
    slug: "2026-mlb-saves-leaders",
    title: "2026 MLB Saves Leaders",
    description: "Live 2026 MLB saves leaders, updated while the season is tracking.",
    season: "2026",
    family: "season_leaders",
    slotQuantity: 50,
    rule: topRule(2026, "pitching", "saves", "saves"),
  }),
  {
    kind: "master",
    slug: "2025-mlb-batting-leaders-master",
    title: "2025 MLB Batting Leaders",
    description: "Complete and keep active every 2025 batting leader collection.",
    sport: "MLB",
    league: "MLB",
    season: "2025",
    family: "masters",
    lifecycle: "final",
    prerequisiteSlugs: [
      "2025-mlb-home-run-leaders",
      "2025-mlb-rbi-leaders",
      "2025-mlb-ops-leaders",
      "2025-mlb-stolen-base-leaders",
    ],
  },
  {
    kind: "master",
    slug: "2025-mlb-pitching-leaders-master",
    title: "2025 MLB Pitching Leaders",
    description: "Complete and keep active every 2025 pitching leader collection.",
    sport: "MLB",
    league: "MLB",
    season: "2025",
    family: "masters",
    lifecycle: "final",
    prerequisiteSlugs: [
      "2025-mlb-strikeout-leaders",
      "2025-mlb-era-leaders",
      "2025-mlb-saves-leaders",
    ],
  },
  {
    kind: "master",
    slug: "2025-mlb-season-leaders-master",
    title: "2025 MLB Season Leaders",
    description: "Complete and keep active both 2025 season-leader master collections.",
    sport: "MLB",
    league: "MLB",
    season: "2025",
    family: "masters",
    lifecycle: "final",
    prerequisiteSlugs: ["2025-mlb-batting-leaders-master", "2025-mlb-pitching-leaders-master"],
  },
];
