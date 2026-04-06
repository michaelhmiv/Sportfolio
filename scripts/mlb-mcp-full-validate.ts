import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_URL = "http://127.0.0.1:8081/mcp";

type ToolResult = {
  toolName: string;
  status: "passed" | "failed";
  durationMs: number;
  args: Record<string, unknown>;
  summary?: string;
  error?: string;
};

type CachedPayloads = {
  statcastData?: Record<string, unknown>;
  statcastBatterData?: Record<string, unknown>;
  teamBattingData?: Record<string, unknown>;
};

function parseArgs(argv: string[]) {
  let url = DEFAULT_URL;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--url" && argv[index + 1]) {
      url = argv[index + 1];
      index += 1;
      continue;
    }
    if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: tsx scripts/mlb-mcp-full-validate.ts [--url http://127.0.0.1:8081/mcp]");
      process.exit(0);
    }
  }
  return { url };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeJsonParse(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractTextContent(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null;
  }

  const parts = content
    .filter((entry) => isRecord(entry) && entry.type === "text" && typeof entry.text === "string")
    .map((entry) => String(entry.text).trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function extractPayload(result: { structuredContent?: unknown; content?: unknown }) {
  if (result.structuredContent != null) {
    if (isRecord(result.structuredContent) && result.structuredContent.result != null) {
      return result.structuredContent.result;
    }
    return result.structuredContent;
  }

  const text = extractTextContent(result.content);
  return safeJsonParse(text) ?? { text };
}

function summarizePayload(payload: unknown): string {
  if (Array.isArray(payload)) {
    return `array(${payload.length})`;
  }
  if (isRecord(payload)) {
    if (Array.isArray(payload.data)) {
      return `data(${payload.data.length})`;
    }
    if (Array.isArray(payload.games)) {
      return `games(${payload.games.length})`;
    }
    if (Array.isArray(payload.leaders)) {
      return `leaders(${payload.leaders.length})`;
    }
    if (typeof payload.image_base64 === "string") {
      return `${String(payload.plot_type || "plot")}(${payload.image_base64.length}b64)`;
    }
    return `keys(${Object.keys(payload).slice(0, 6).join(",")})`;
  }
  return typeof payload;
}

async function getCachedPayload(
  client: Client,
  cache: CachedPayloads,
  key: keyof CachedPayloads,
  loader: () => Promise<Record<string, unknown>>,
) {
  if (!cache[key]) {
    cache[key] = await loader();
  }
  return cache[key]!;
}

async function callToolPayload(
  client: Client,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({
    name: toolName,
    arguments: args,
  });
  if (result.isError) {
    throw new Error(extractTextContent(result.content) || `MCP error for ${toolName}`);
  }
  const payload = extractPayload(result);
  if (!isRecord(payload)) {
    throw new Error(`Expected object payload from ${toolName}`);
  }
  return payload;
}

async function buildFixtureArgs(
  client: Client,
  cache: CachedPayloads,
  toolName: string,
): Promise<Record<string, unknown>> {
  switch (toolName) {
    case "get_stats":
      return { endpoint: "teams", params: { sportId: 1 } };
    case "get_schedule":
      return {
        start_date: "07/01/2018",
        end_date: "07/31/2018",
        team_id: 143,
        opponent_id: 121,
      };
    case "get_player_stats":
      return { player_id: 592450, group: "hitting", season: 2023, stats: "season" };
    case "get_standings":
      return { season: 2023, standings_types: "regularSeason" };
    case "get_team_leaders":
      return { team_id: 147, season: 2023, leader_category: "walks", limit: 10 };
    case "lookup_player":
      return { name: "Aaron Judge" };
    case "get_boxscore":
      return { game_id: 565997 };
    case "get_team_roster":
      return { team_id: 147, roster_type: "active", season: 2023 };
    case "get_game_pace":
      return { season: 2023 };
    case "get_meta":
      return { type_name: "positions" };
    case "get_available_endpoints":
      return {};
    case "get_notes":
      return { endpoint: "teams" };
    case "get_game_scoring_play_data":
      return { game_id: 565997 };
    case "get_last_game":
      return { team_id: 147 };
    case "get_league_leader_data":
      return { leader_categories: "homeRuns,strikeouts", limit: 5, stat_group: "hitting" };
    case "get_linescore":
      return { game_id: 565997 };
    case "get_next_game":
      return { team_id: 147 };
    case "get_game_highlight_data":
      return { game_id: 565997 };
    case "get_statcast_data":
      return { start_dt: "2018-05-01", end_dt: "2018-05-04", end_row: 50 };
    case "get_statcast_batter_data":
      return { player_id: 514888, start_dt: "2019-05-01", end_dt: "2019-07-01", end_row: 50 };
    case "get_statcast_pitcher_data":
      return { player_id: 543037, start_dt: "2022-04-01", end_dt: "2022-10-31", end_row: 50 };
    case "get_statcast_batter_exitvelo_barrels":
      return { year: 2023, minBBE: 50 };
    case "get_statcast_pitcher_exitvelo_barrels":
      return { year: 2023, minBBE: 50 };
    case "get_statcast_batter_expected_stats":
      return { year: 2023, minPA: 50 };
    case "get_statcast_pitcher_expected_stats":
      return { year: 2023, minPA: 50 };
    case "get_statcast_batter_percentile_ranks":
      return { year: 2023 };
    case "get_statcast_pitcher_percentile_ranks":
      return { year: 2023 };
    case "get_statcast_batter_pitch_arsenal":
      return { year: 2023, minPA: 50 };
    case "get_statcast_pitcher_pitch_arsenal":
      return { year: 2023, minP: 50, arsenal_type: "avg_speed" };
    case "get_statcast_single_game":
      return { game_pk: 717953 };
    case "create_strike_zone_plot":
      return {
        data: await getCachedPayload(client, cache, "statcastData", () =>
          callToolPayload(client, "get_statcast_data", {
            start_dt: "2018-05-01",
            end_dt: "2018-05-04",
            end_row: 50,
          }),
        ),
        title: "Validation strike zone",
        colorby: "pitch_type",
        annotation: "pitch_type",
      };
    case "create_spraychart_plot":
      return {
        data: await getCachedPayload(client, cache, "statcastBatterData", () =>
          callToolPayload(client, "get_statcast_batter_data", {
            player_id: 514888,
            start_dt: "2019-05-01",
            end_dt: "2019-07-01",
            end_row: 50,
          }),
        ),
        team_stadium: "astros",
        title: "Validation spray chart",
        colorby: "events",
        size: 120,
        width: 800,
        height: 800,
      };
    case "create_bb_profile_plot":
      return {
        data: await getCachedPayload(client, cache, "statcastData", () =>
          callToolPayload(client, "get_statcast_data", {
            start_dt: "2018-05-01",
            end_dt: "2018-05-04",
            end_row: 50,
          }),
        ),
        parameter: "launch_angle",
      };
    case "create_teams_plot":
      return {
        data: await getCachedPayload(client, cache, "teamBattingData", () =>
          callToolPayload(client, "get_team_batting", {
            start_season: 2023,
            league: "all",
          }),
        ),
        x_axis: "HR",
        y_axis: "BB",
        title: "Validation team plot",
      };
    case "get_pitching_stats_bref":
      return { season: 2023 };
    case "get_pitching_stats_range":
      return { start_dt: "2023-05-01", end_dt: "2023-05-07" };
    case "get_pitching_stats":
      return { start_season: 2023, league: "all" };
    case "get_playerid_lookup":
      return { last: "Judge", first: "Aaron" };
    case "reverse_lookup_player":
      return { player_ids: [592450], key_type: "mlbam" };
    case "get_schedule_and_record":
      return { season: 2023, team: "LAD" };
    case "get_player_splits":
      return { playerid: "troutmi01", year: 2023 };
    case "get_pybaseball_standings":
      return { season: 2023 };
    case "get_team_batting":
      return { start_season: 2023, league: "all" };
    case "get_team_fielding":
      return { start_season: 2023, league: "all" };
    case "get_team_pitching":
      return { start_season: 2023, league: "all" };
    case "get_top_prospects":
      return { team: "angels", player_type: "batters" };
    default:
      throw new Error(`No validation fixture is configured for ${toolName}`);
  }
}

async function main() {
  const { url } = parseArgs(process.argv.slice(2));
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client(
    {
      name: "sportfolio-mlb-mcp-full-validator",
      version: "1.0.0",
    },
    { capabilities: {} },
  );
  const cache: CachedPayloads = {};

  try {
    await client.connect(transport);
    const toolListing = await client.listTools();
    const tools = toolListing.tools.map((tool) => tool.name).sort();
    const results: ToolResult[] = [];

    for (const toolName of tools) {
      const startedAt = Date.now();
      let args: Record<string, unknown> = {};
      try {
        args = await buildFixtureArgs(client, cache, toolName);
        const result = await client.callTool({
          name: toolName,
          arguments: args,
        });
        if (result.isError) {
          throw new Error(extractTextContent(result.content) || `MCP error for ${toolName}`);
        }
        results.push({
          toolName,
          status: "passed",
          durationMs: Date.now() - startedAt,
          args,
          summary: summarizePayload(extractPayload(result)),
        });
      } catch (error) {
        results.push({
          toolName,
          status: "failed",
          durationMs: Date.now() - startedAt,
          args,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failed = results.filter((entry) => entry.status === "failed");
    const report = {
      ok: failed.length === 0,
      url,
      toolCount: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    };

    console.log(JSON.stringify(report, null, 2));
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await transport.close().catch(() => {});
    await client.close().catch(() => {});
  }
}

void main();
