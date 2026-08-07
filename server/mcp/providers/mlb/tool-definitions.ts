import { z } from "zod";
import { CURATED_MLB_TOOL_NAMES, type CuratedMlbToolName } from "./provider";

type RawSchema = Record<string, z.ZodTypeAny>;
export type CuratedMlbToolDefinition = {
  name: CuratedMlbToolName;
  description: string;
  inputSchema: RawSchema;
  fixtureArgs: Record<string, unknown>;
};

const season = z
  .number()
  .int()
  .min(1876)
  .max(new Date().getUTCFullYear() + 1)
  .optional();
const limit = z.number().int().min(1).max(100).optional().default(10);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CURATED_MLB_TOOLS: CuratedMlbToolDefinition[] = [
  {
    name: "search_mlb_players",
    description:
      "Search MLB players by name. Use this before player-specific MLB tools when the player identifier is unknown.",
    inputSchema: { query: z.string().trim().min(2).max(120) },
    fixtureArgs: { query: "Aaron Judge" },
  },
  {
    name: "get_mlb_batting_leaders",
    description:
      "Return season-to-date MLB batting leaders. Use for questions such as ‘Who are the top five MLB hitters in OPS this season?’ Do not use for pitching metrics or a single team.",
    inputSchema: {
      metric: z.enum([
        "avg",
        "obp",
        "slg",
        "ops",
        "home_runs",
        "rbi",
        "runs",
        "hits",
        "stolen_bases",
        "war",
      ]),
      season,
      league: z.enum(["mlb", "al", "nl"]).optional().default("mlb"),
      limit,
      qualification: z.enum(["qualified", "all"]).optional().default("qualified"),
    },
    fixtureArgs: { metric: "ops", season: 2026, league: "mlb", limit: 5 },
  },
  {
    name: "get_mlb_pitching_leaders",
    description:
      "Return season-to-date MLB pitching leaders. Use for ERA, wins, strikeouts, WHIP, saves, innings, or pitching WAR leader questions.",
    inputSchema: {
      metric: z.enum(["era", "wins", "strikeouts", "whip", "saves", "innings", "war"]),
      season,
      league: z.enum(["mlb", "al", "nl"]).optional().default("mlb"),
      limit,
      qualification: z.enum(["qualified", "all"]).optional().default("qualified"),
    },
    fixtureArgs: { metric: "era", season: 2026, league: "mlb", limit: 5 },
  },
  {
    name: "get_mlb_player_stats",
    description: "Load season or career MLB statistics for one known MLBAM player id.",
    inputSchema: {
      playerId: z.number().int().positive(),
      group: z.enum(["hitting", "pitching", "fielding"]).optional().default("hitting"),
      season,
      stats: z
        .enum(["season", "career", "seasonAdvanced", "careerAdvanced"])
        .optional()
        .default("season"),
    },
    fixtureArgs: { playerId: 592450, group: "hitting", season: 2026, stats: "season" },
  },
  {
    name: "get_mlb_player_splits",
    description:
      "Load a player’s batting or pitching splits for a season. Use after resolving the provider-specific player id.",
    inputSchema: { playerId: z.string().trim().min(1), season },
    fixtureArgs: { playerId: "troutmi01", season: 2026 },
  },
  {
    name: "get_mlb_team_leaders",
    description:
      "Return leaders for one MLB team and one statistic. Use for team-specific leader questions, not leaguewide rankings.",
    inputSchema: {
      teamId: z.number().int().positive(),
      metric: z.string().trim().min(1).max(80),
      season,
      limit,
    },
    fixtureArgs: { teamId: 147, metric: "homeRuns", season: 2026, limit: 5 },
  },
  {
    name: "get_mlb_games",
    description:
      "Return the MLB schedule for a calendar date, including matchup and game status. Use for ‘Who plays today?’ questions.",
    inputSchema: { date },
    fixtureArgs: { date: "2026-08-06" },
  },
  {
    name: "get_mlb_game_details",
    description: "Return box-score and game details for one MLB game id.",
    inputSchema: { gameId: z.number().int().positive() },
    fixtureArgs: { gameId: 565997 },
  },
  {
    name: "get_mlb_probable_pitchers",
    description:
      "Return probable pitchers for MLB games on a date. Use for probable-starter slate questions.",
    inputSchema: { date },
    fixtureArgs: { date: "2026-08-06" },
  },
  {
    name: "get_mlb_standings",
    description: "Return MLB standings for a season.",
    inputSchema: {
      season,
      type: z
        .enum(["regularSeason", "springTraining", "wildCard"])
        .optional()
        .default("regularSeason"),
    },
    fixtureArgs: { season: 2026, type: "regularSeason" },
  },
  {
    name: "get_mlb_roster",
    description:
      "Return a team roster for a season. This confirms active membership but does not guarantee today’s lineup.",
    inputSchema: {
      teamId: z.number().int().positive(),
      rosterType: z.enum(["active", "40Man", "fullSeason"]).optional().default("active"),
      season,
    },
    fixtureArgs: { teamId: 147, rosterType: "active", season: 2026 },
  },
  {
    name: "get_mlb_statcast_profile",
    description: "Return Statcast expected-stat profile data for batters or pitchers in a season.",
    inputSchema: {
      role: z.enum(["batter", "pitcher"]),
      season: z
        .number()
        .int()
        .min(2008)
        .max(new Date().getUTCFullYear() + 1)
        .optional(),
      minimum: z.number().int().min(0).max(1000).optional().default(50),
    },
    fixtureArgs: { role: "batter", season: 2026, minimum: 50 },
  },
];

if (CURATED_MLB_TOOLS.map((tool) => tool.name).join("|") !== CURATED_MLB_TOOL_NAMES.join("|")) {
  throw new Error("Curated MLB tool definition order does not match the published catalog.");
}
