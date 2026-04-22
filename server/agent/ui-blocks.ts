import {
  isAgentUiBlockSlot,
  isAgentUiBlockType,
  type AgentUiBlock,
  type AgentUiEntityCell,
  type AgentUiBlockSlot,
} from "@shared/agent-ui";
import {
  normalizeAgentStrategyTimeline,
  summarizeAgentStrategyTrigger,
} from "@shared/agent-strategy";
import type {
  AgentCitation,
  AgentPendingClarification,
  AgentToolDefinition,
  HermesConversationMode,
  HermesRespondResult,
  HermesStrategyContext,
} from "./types";

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return null;
}

function normalizeBlockSlot(value: unknown): AgentUiBlockSlot | null {
  return isAgentUiBlockSlot(value) ? value : null;
}

function getPrimarySlot(mode: HermesConversationMode | null | undefined): AgentUiBlockSlot {
  return mode && mode !== "general_chat" ? "strategy_overview" : "chat_header";
}

function getInlineSlot(mode: HermesConversationMode | null | undefined): AgentUiBlockSlot {
  return mode && mode !== "general_chat" ? "strategy_chat" : "chat_inline";
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function startCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMoney(value: number | null) {
  if (value == null) {
    return "-";
  }

  return `$${value.toFixed(Math.abs(value) >= 100 ? 0 : 2)}`;
}

function formatNumber(value: number | null) {
  if (value == null) {
    return "-";
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  if (Math.abs(value) >= 100) {
    return value.toFixed(0);
  }

  return value.toFixed(2);
}

function formatEtTimestamp(value: unknown) {
  const text = toString(value);
  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function buildPlayerHref(playerId: string | null) {
  return playerId ? `/player/${encodeURIComponent(playerId)}` : null;
}

function getToolResultSummary(result: unknown) {
  if (!result || typeof result !== "object") {
    return null;
  }

  return toString((result as { summary?: unknown }).summary);
}

function collectObjectArrays(
  value: unknown,
  input: { maxDepth?: number; key?: string; seen?: WeakSet<object> } = {},
): Array<Record<string, unknown>[]> {
  const maxDepth = input.maxDepth ?? 4;
  const seen = input.seen ?? new WeakSet<object>();
  const key = input.key || null;

  if (maxDepth < 0 || value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    const objectEntries = value.filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    );

    const directMatches =
      objectEntries.length > 0 && objectEntries.length === value.length ? [objectEntries] : [];

    return [
      ...directMatches,
      ...value.flatMap((entry) =>
        collectObjectArrays(entry, {
          maxDepth: maxDepth - 1,
          seen,
        }),
      ),
    ];
  }

  if (typeof value !== "object") {
    return [];
  }

  if (seen.has(value as object)) {
    return [];
  }
  seen.add(value as object);

  const record = value as Record<string, unknown>;
  return Object.entries(record).flatMap(([entryKey, entryValue]) => {
    if (["warnings", "observations", "citations", "content"].includes(entryKey)) {
      return [];
    }

    return collectObjectArrays(entryValue, {
      maxDepth: maxDepth - 1,
      key: key ? `${key}.${entryKey}` : entryKey,
      seen,
    });
  });
}

function getFirstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = toString(record[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function getFirstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value != null) {
      return value;
    }
  }

  return null;
}

function resolvePlayerId(record: Record<string, unknown>) {
  const directPlayerId = getFirstString(record, ["playerId", "entityId"]);
  if (directPlayerId) {
    return directPlayerId;
  }

  const entityType = getFirstString(record, ["entityType", "type"]);
  const genericId = getFirstString(record, ["id"]);
  if (entityType === "player" && genericId) {
    return genericId;
  }

  return null;
}

function formatStatsSummary(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const parts = value
    .map((entry) => {
      const record = toRecord(entry);
      const label = toString(record.label);
      const rank = toNumber(record.rank);
      const valueLabel = toString(record.valueLabel);
      if (!label) {
        return null;
      }

      const suffix = [rank != null ? `#${rank}` : null, valueLabel].filter(Boolean).join(" ");
      return suffix ? `${label} ${suffix}` : label;
    })
    .filter((entry): entry is string => Boolean(entry));

  return parts.length > 0 ? parts.join(", ") : null;
}

function formatGameSummary(value: unknown) {
  const record = toRecord(value);
  const opponent = getFirstString(record, ["opponent", "awayTeam", "away_team", "matchup"]);
  const startTime = formatEtTimestamp(
    record.startTime ?? record.start_time ?? record.gameStartTime,
  );
  const status = getFirstString(record, ["status", "gameStatus"]);
  const parts = [opponent, startTime, status].filter(Boolean);
  return parts.length > 0 ? parts.join(" - ") : null;
}

function extractInternalMlbLeaderboardRows(value: unknown): Record<string, unknown>[] {
  const leaders = Array.isArray(
    (value as { result?: { leaders?: unknown[] } } | null)?.result?.leaders,
  )
    ? ((value as { result?: { leaders?: unknown[] } }).result?.leaders as unknown[])
    : [];

  return leaders
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 4) {
        return null;
      }

      return {
        rank: toNumber(entry[0]),
        playerName: toString(entry[1]),
        teamName: toString(entry[2]),
        valueLabel: toString(entry[3]),
        numericValue: toNumber(entry[3]),
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        rank: number | null;
        playerName: string | null;
        teamName: string | null;
        valueLabel: string | null;
        numericValue: number | null;
      } => Boolean(entry?.playerName),
    );
}

function derivePrimaryStatLabel(tool: AgentToolDefinition) {
  const preferredColumns = tool.preferredColumns || [];
  const metricColumn =
    preferredColumns.find(
      (entry) =>
        ![
          "rank",
          "player",
          "name",
          "team",
          "matchup",
          "status",
          "startTime",
          "venue",
          "date",
          "opponent",
        ].includes(entry),
    ) || "value";

  return startCase(metricColumn);
}

function buildGenericScheduleBoard(input: {
  title: string;
  helper: string | null;
  rows: Array<Record<string, unknown>>;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock | null {
  const normalizedRows = input.rows
    .map((entry, index) => {
      const id =
        getFirstString(entry, ["id", "gameId", "game_id"]) ||
        `${getFirstString(entry, ["awayTeam", "away_team"]) || "away"}-${getFirstString(entry, ["homeTeam", "home_team"]) || "home"}-${index}`;
      const matchup =
        getFirstString(entry, ["matchup"]) ||
        (() => {
          const awayTeam = getFirstString(entry, ["awayTeam", "away_team"]);
          const homeTeam = getFirstString(entry, ["homeTeam", "home_team"]);
          return awayTeam && homeTeam ? `${awayTeam} @ ${homeTeam}` : null;
        })();

      if (!matchup) {
        return null;
      }

      return {
        id,
        matchup,
        status: getFirstString(entry, ["status", "gameStatus", "game_status"]),
        startTime: formatEtTimestamp(
          entry.startTime ?? entry.start_time ?? entry.gameDate ?? entry.game_date,
        ),
        venue: getFirstString(entry, ["venue", "venueName", "stadium"]),
        href: getFirstString(entry, ["href", "url"]),
        chips: toStringArray(entry.chips).slice(0, 3),
        probableAwayPitcher: getFirstString(entry, [
          "probableAwayPitcher",
          "awayProbablePitcher",
          "away_probable_pitcher",
        ]),
        probableHomePitcher: getFirstString(entry, [
          "probableHomePitcher",
          "homeProbablePitcher",
          "home_probable_pitcher",
        ]),
        note: getFirstString(entry, ["note"]),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .slice(0, 12);

  if (normalizedRows.length === 0) {
    return null;
  }

  return {
    type: "schedule_board",
    slot: getInlineSlot(input.conversationMode),
    priority: 30,
    props: {
      title: input.title,
      helper: input.helper,
      rows: normalizedRows,
    },
  };
}

function buildLeaderboardBlockFromEntries(input: {
  title: string;
  helper: string | null;
  statLabel: string;
  rows: Array<Record<string, unknown>>;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock | null {
  const leaders = input.rows
    .map((entry, index) => {
      const playerName = getFirstString(entry, ["playerName", "name", "player", "fullName"]);
      if (!playerName) {
        return null;
      }

      const playerId = resolvePlayerId(entry);
      const primaryValue =
        getFirstString(entry, [
          "valueLabel",
          "primaryValue",
          "value",
          "fantasyPoints",
          "metric",
          "score",
        ]) ||
        formatNumber(getFirstNumber(entry, ["numericValue", "value", "score"])) ||
        "-";

      return {
        id: getFirstString(entry, ["id"]) || `${playerName}-${index + 1}`,
        rank: getFirstNumber(entry, ["rank"]) || index + 1,
        playerName,
        playerId,
        href: buildPlayerHref(playerId),
        team: getFirstString(entry, ["team", "teamName", "team_name"]),
        secondaryText:
          getFirstString(entry, ["position", "sport"]) ||
          formatStatsSummary(entry.stats) ||
          formatGameSummary(entry.game),
        badge: getFirstString(entry, ["badge"]),
        primaryValue,
        secondaryValue: getFirstString(entry, ["secondaryValue"]),
        note: getFirstString(entry, ["note"]),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .slice(0, 10);

  if (leaders.length === 0) {
    return null;
  }

  return {
    type: "leaderboard_table",
    slot: getInlineSlot(input.conversationMode),
    priority: 30,
    props: {
      title: input.title,
      helper: input.helper,
      statLabel: input.statLabel,
      leaders,
    },
  };
}

function formatColumnLabel(key: string) {
  switch (key) {
    case "player":
      return "Player";
    case "team":
      return "Team";
    case "position":
      return "Pos";
    case "price":
      return "Price";
    case "signal":
      return "Signal";
    case "opportunity":
      return "Opportunity";
    case "metric":
      return "Metric";
    case "game":
      return "Game";
    case "power":
      return "Power";
    case "boostSlot":
      return "Boost Slot";
    case "scoutCount":
      return "Scouts";
    case "quantity":
      return "Qty";
    case "matchup":
      return "Matchup";
    case "status":
      return "Status";
    case "startTime":
      return "Start";
    case "venue":
      return "Venue";
    case "opponent":
      return "Opponent";
    case "boostEligible":
      return "Boost Eligible";
    case "date":
      return "Date";
    case "fantasyPoints":
      return "FP";
    case "name":
      return "Name";
    case "category":
      return "Category";
    case "riskLevel":
      return "Risk";
    case "source":
      return "Source";
    default:
      return startCase(key);
  }
}

function buildEntityCellFromColumn(entry: Record<string, unknown>, key: string) {
  const playerId = resolvePlayerId(entry);
  switch (key) {
    case "player": {
      const text = getFirstString(entry, ["playerName", "name", "player", "fullName"]);
      if (!text) {
        return null;
      }
      return {
        text,
        secondaryText: getFirstString(entry, ["position", "sport"]),
        entityType: playerId ? ("player" as const) : null,
        entityId: playerId,
        href: buildPlayerHref(playerId),
      };
    }
    case "team":
      return { text: getFirstString(entry, ["team", "teamName", "team_name"]) || "-" };
    case "position":
      return { text: getFirstString(entry, ["position"]) || "-" };
    case "price":
      return {
        text: formatMoney(
          getFirstNumber(entry, ["price", "currentPrice", "lastTradePrice", "lastTradePrice"]),
        ),
        align: "right" as const,
      };
    case "signal":
    case "opportunity":
      return {
        text:
          getFirstString(entry, ["reason", "opportunity", "signal", "note"]) ||
          formatStatsSummary(entry.stats) ||
          "-",
      };
    case "metric":
      return {
        text:
          formatStatsSummary(entry.stats) ||
          getFirstString(entry, ["metric", "valueLabel", "value"]) ||
          "-",
      };
    case "game":
      return {
        text: formatGameSummary(entry.game) || getFirstString(entry, ["game", "opponent"]) || "-",
      };
    case "power":
      return {
        text:
          getFirstNumber(entry, ["multiplier", "power", "powerLevel"]) != null
            ? `${formatNumber(getFirstNumber(entry, ["multiplier", "power", "powerLevel"]))}x`
            : "-",
        align: "right" as const,
      };
    case "boostSlot":
      return {
        text:
          getFirstNumber(entry, ["slotTier", "boostSlot"]) != null
            ? `${formatNumber(getFirstNumber(entry, ["slotTier", "boostSlot"]))}x`
            : "-",
        align: "right" as const,
      };
    case "scoutCount":
      return {
        text: formatNumber(
          getFirstNumber(entry, [
            "targetCount",
            "currentScoutCount",
            "scoutCount",
            "count",
            "globalScoutCount",
          ]),
        ),
        align: "right" as const,
      };
    case "quantity":
      return {
        text: formatNumber(getFirstNumber(entry, ["quantity", "availableShares", "shares"])),
        align: "right" as const,
      };
    case "matchup":
      return {
        text:
          getFirstString(entry, ["matchup"]) ||
          (() => {
            const awayTeam = getFirstString(entry, ["awayTeam", "away_team"]);
            const homeTeam = getFirstString(entry, ["homeTeam", "home_team"]);
            return awayTeam && homeTeam ? `${awayTeam} @ ${homeTeam}` : null;
          })() ||
          "-",
      };
    case "status":
      return { text: getFirstString(entry, ["status", "gameStatus", "game_status"]) || "-" };
    case "startTime":
      return {
        text:
          formatEtTimestamp(
            entry.startTime ?? entry.start_time ?? entry.gameDate ?? entry.game_date,
          ) || "-",
      };
    case "venue":
      return { text: getFirstString(entry, ["venue", "venueName", "stadium"]) || "-" };
    case "opponent":
      return { text: getFirstString(entry, ["opponent"]) || "-" };
    case "boostEligible": {
      const eligible = toBoolean(entry.boostEligible);
      return {
        text: eligible == null ? "-" : eligible ? "Yes" : "No",
        tone: eligible == null ? null : eligible ? ("positive" as const) : ("warning" as const),
      };
    }
    case "date":
      return { text: formatEtTimestamp(entry.date ?? entry.startTime ?? entry.gameDate) || "-" };
    case "fantasyPoints":
      return {
        text: formatNumber(getFirstNumber(entry, ["fantasyPoints", "fantasy_points", "fp"])),
        align: "right" as const,
      };
    case "name":
      return { text: getFirstString(entry, ["name"]) || "-" };
    case "category":
      return { text: getFirstString(entry, ["category"]) || "-" };
    case "riskLevel":
      return { text: getFirstString(entry, ["riskLevel"]) || "-" };
    case "source":
      return { text: getFirstString(entry, ["source", "provider"]) || "-" };
    default:
      return {
        text: getFirstString(entry, [key]) || formatNumber(getFirstNumber(entry, [key])) || "-",
      };
  }
}

function buildEntityTableFromEntries(input: {
  title: string;
  helper: string | null;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock | null {
  const normalizedRows = input.rows
    .map((entry, index) => {
      const cells = Object.fromEntries(
        input.columns.map((column) => [column, buildEntityCellFromColumn(entry, column)]),
      );
      const populatedCells = Object.fromEntries(
        Object.entries(cells).filter(([, value]) => value != null),
      ) as Record<string, AgentUiEntityCell>;

      if (Object.keys(populatedCells).length === 0) {
        return null;
      }

      return {
        id:
          getFirstString(entry, ["id", "playerId", "gameId"]) ||
          `${getFirstString(entry, ["name", "playerName"]) || "row"}-${index}`,
        rank: getFirstNumber(entry, ["rank"]),
        cells: populatedCells,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .slice(0, 12);

  if (normalizedRows.length === 0) {
    return null;
  }

  return {
    type: "entity_table",
    slot: getInlineSlot(input.conversationMode),
    priority: 30,
    props: {
      title: input.title,
      helper: input.helper,
      columns: input.columns.map((column) => ({
        key: column,
        label: formatColumnLabel(column),
        align: ["price", "power", "boostSlot", "scoutCount", "quantity", "fantasyPoints"].includes(
          column,
        )
          ? ("right" as const)
          : null,
      })),
      rows: normalizedRows,
    },
  };
}

function buildToolCatalogBlock(input: {
  toolEntries: AgentToolDefinition[];
  conversationMode: HermesConversationMode | null | undefined;
}) {
  if (input.toolEntries.length === 0) {
    return null;
  }

  const groups = Array.from(
    input.toolEntries.reduce((map, tool) => {
      const key = tool.category;
      const current = map.get(key) || [];
      current.push(tool);
      map.set(key, current);
      return map;
    }, new Map<string, AgentToolDefinition[]>()),
  )
    .map(([category, tools]) => ({
      id: category,
      label: startCase(category),
      tools: tools.slice(0, 8).map((tool) => ({
        name: tool.toolName,
        description: tool.description,
        riskLevel: tool.riskLevel,
        examplePrompt: tool.examplePrompts[0] || null,
        presentationProfile: tool.presentationProfile || null,
        primaryEntityType: tool.primaryEntityType || null,
      })),
    }))
    .slice(0, 6);

  return {
    type: "tool_catalog_summary" as const,
    slot: getInlineSlot(input.conversationMode),
    priority: 30,
    props: {
      title: "Hermes tool surface",
      helper: "Current runtime tools available for this turn.",
      groups,
    },
  };
}

function buildToolSpecificUiBlocks(input: {
  tool: AgentToolDefinition;
  result: unknown;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock[] {
  const summary = getToolResultSummary(input.result);
  const resultRecord = toRecord(input.result);
  const context = toRecord(resultRecord.context);

  switch (input.tool.toolName) {
    case "scan_sport_slate": {
      const games = Array.isArray(context.games)
        ? context.games.filter(
            (entry): entry is Record<string, unknown> =>
              Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
          )
        : [];
      const block = buildGenericScheduleBoard({
        title: "Slate board",
        helper: summary,
        rows: games,
        conversationMode: input.conversationMode,
      });
      return block ? [block] : [];
    }
    case "scan_team_roster": {
      const players = Array.isArray(context.players)
        ? context.players.filter(
            (entry): entry is Record<string, unknown> =>
              Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
          )
        : [];
      const block = buildEntityTableFromEntries({
        title: "Team roster",
        helper: summary,
        columns: ["player", "position", "team", "price"],
        rows: players,
        conversationMode: input.conversationMode,
      });
      return block ? [block] : [];
    }
    case "scan_player_upcoming_games": {
      const players = Array.isArray(context.players)
        ? context.players.flatMap((entry) => {
            const record = toRecord(entry);
            const games = Array.isArray(record.upcomingGames)
              ? record.upcomingGames.map((game) => ({
                  ...toRecord(game),
                  playerId: record.playerId,
                  name: toString(record.name),
                  opponent: toString(toRecord(game).opponent),
                  boostEligible: true,
                }))
              : [];
            return games.length > 0 ? games : [{ ...record, boostEligible: false }];
          })
        : [];
      const block = buildEntityTableFromEntries({
        title: "Upcoming games",
        helper: summary,
        columns: ["player", "opponent", "startTime", "boostEligible"],
        rows: players,
        conversationMode: input.conversationMode,
      });
      return block ? [block] : [];
    }
    case "scan_daily_boost_candidates": {
      const candidates = Array.isArray(context.candidates)
        ? context.candidates.filter(
            (entry): entry is Record<string, unknown> =>
              Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
          )
        : [];
      const block = buildEntityTableFromEntries({
        title: "Boost candidates",
        helper: summary,
        columns: ["player", "team", "power", "boostSlot"],
        rows: candidates,
        conversationMode: input.conversationMode,
      });
      return block ? [block] : [];
    }
    case "scan_scout_opportunities":
    case "scan_watchlist_targets": {
      const targets = Array.isArray(context.recommendedTargets)
        ? context.recommendedTargets.filter(
            (entry): entry is Record<string, unknown> =>
              Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
          )
        : [];
      const block = buildEntityTableFromEntries({
        title: "Ranked players",
        helper: summary,
        columns: ["player", "scoutCount", "opportunity"],
        rows: targets,
        conversationMode: input.conversationMode,
      });
      return block ? [block] : [];
    }
    case "scan_top_market_opportunities":
    case "scan_idle_balance_options": {
      const targets = Array.isArray(context.recommendedTargets)
        ? context.recommendedTargets.filter(
            (entry): entry is Record<string, unknown> =>
              Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
          )
        : [];
      const block = buildEntityTableFromEntries({
        title: "Ranked players",
        helper: summary,
        columns: ["player", "team", "price", "opportunity"],
        rows: targets,
        conversationMode: input.conversationMode,
      });
      return block ? [block] : [];
    }
    case "scan_mlb_stat_gameplan": {
      const candidates = Array.isArray(context.candidates)
        ? context.candidates.filter(
            (entry): entry is Record<string, unknown> =>
              Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
          )
        : [];
      const block = buildEntityTableFromEntries({
        title: "MLB stat gameplan",
        helper: summary,
        columns: ["player", "team", "price", "metric", "game"],
        rows: candidates,
        conversationMode: input.conversationMode,
      });
      return block ? [block] : [];
    }
    case "get_tool_catalog":
      if (!Array.isArray(input.result)) {
        return [];
      }

      const block = buildToolCatalogBlock({
        toolEntries: input.result.filter(
          (entry): entry is AgentToolDefinition =>
            Boolean(entry) &&
            typeof entry === "object" &&
            typeof (entry as { toolName?: unknown }).toolName === "string" &&
            typeof (entry as { category?: unknown }).category === "string",
        ),
        conversationMode: input.conversationMode,
      });
      return block ? [block] : [];
    default:
      return [];
  }
}

export function buildToolResultUiBlocks(input: {
  tool: AgentToolDefinition;
  result: unknown;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock[] {
  const explicitBlocks = normalizeAgentUiBlocks(
    (input.result as { uiBlocks?: unknown } | null)?.uiBlocks,
  );
  if (explicitBlocks.length > 0) {
    return explicitBlocks;
  }

  const specificBlocks = buildToolSpecificUiBlocks(input);
  if (specificBlocks.length > 0) {
    return specificBlocks;
  }

  const resultRecord = toRecord(input.result);
  const context = toRecord(resultRecord.context);
  const summary = getToolResultSummary(input.result);

  if (input.tool.presentationProfile === "schedule") {
    const candidateRows =
      (Array.isArray(context.games) ? [context.games] : []).concat(
        collectObjectArrays(context.structuredContent),
        collectObjectArrays(input.result),
      )[0] || [];
    const block = buildGenericScheduleBoard({
      title: startCase(input.tool.toolName.replace(/^mlb_mcp__/, "")),
      helper: summary,
      rows: candidateRows,
      conversationMode: input.conversationMode,
    });
    return block ? [block] : [];
  }

  if (input.tool.presentationProfile === "leaderboard") {
    const internalMlbLeaderRows =
      input.tool.toolName.startsWith("mlb_mcp__") && context.structuredContent
        ? extractInternalMlbLeaderboardRows(context.structuredContent)
        : [];
    const leaderboardBlock = buildLeaderboardBlockFromEntries({
      title: startCase(input.tool.toolName.replace(/^mlb_mcp__/, "")),
      helper: summary,
      statLabel: derivePrimaryStatLabel(input.tool),
      rows: internalMlbLeaderRows,
      conversationMode: input.conversationMode,
    });
    if (leaderboardBlock) {
      return [leaderboardBlock];
    }
  }

  const columns = input.tool.preferredColumns || [];
  if (columns.length > 0) {
    const arrayCandidates = [
      ...(Array.isArray(input.result) ? [input.result] : []),
      ...collectObjectArrays(context),
      ...collectObjectArrays(input.result),
    ];
    const matchingRows = arrayCandidates.find((rows) =>
      rows.some((entry) =>
        columns.some(
          (column) =>
            buildEntityCellFromColumn(entry, column) != null &&
            buildEntityCellFromColumn(entry, column)?.text !== "-",
        ),
      ),
    );

    if (matchingRows) {
      const block = buildEntityTableFromEntries({
        title: startCase(input.tool.toolName.replace(/^mlb_mcp__/, "")),
        helper: summary,
        columns,
        rows: matchingRows,
        conversationMode: input.conversationMode,
      });
      return block ? [block] : [];
    }
  }

  return [];
}

function getStrategyTimeline(strategyContext: HermesStrategyContext | null | undefined) {
  if (!strategyContext) {
    return null;
  }

  return normalizeAgentStrategyTimeline(strategyContext.normalizedRuleSheet, {
    objective: strategyContext.mandate,
    mandate: strategyContext.mandate,
    rawTimingInstruction: null,
  });
}

function formatScheduleLabel(
  strategyContext: HermesStrategyContext | null | undefined,
): string | null {
  const timeline = getStrategyTimeline(strategyContext);
  const activeStage =
    timeline?.stages.find((stage) => stage.id === timeline.currentStageId) || timeline?.stages[0];
  if (activeStage) {
    return summarizeAgentStrategyTrigger(activeStage.triggerPolicy);
  }

  const normalizedRuleSheet = toRecord(strategyContext?.normalizedRuleSheet);
  const triggerPolicy = toRecord(normalizedRuleSheet.triggerPolicy);
  const scheduleCron = toString(triggerPolicy.scheduleCron);
  if (scheduleCron) {
    return scheduleCron;
  }

  const eventSubscriptions = toStringArray(triggerPolicy.eventSubscriptions);
  if (eventSubscriptions.length > 0) {
    return eventSubscriptions.map(titleCase).join(" + ");
  }

  return null;
}

function extractStrategyActionScope(
  strategyContext: HermesStrategyContext | null | undefined,
  result: HermesRespondResult,
): string[] {
  const normalizedRuleSheet = toRecord(strategyContext?.normalizedRuleSheet);
  const timeline = getStrategyTimeline(strategyContext);
  const activeStage =
    timeline?.stages.find((stage) => stage.id === timeline.currentStageId) || timeline?.stages[0];
  const executionEnvelope = toRecord(normalizedRuleSheet.executionEnvelope);
  const normalizedScope = toStringArray(normalizedRuleSheet.actionScope);
  const stageScope = activeStage?.actionScope || [];
  const envelopeScope = toStringArray(executionEnvelope.allowedActionTypes);
  const proposedScope = result.proposedActions
    .map((action) => action.actionType)
    .filter((entry) => entry.trim().length > 0);

  return Array.from(
    new Set(
      [...normalizedScope, ...envelopeScope, ...proposedScope]
        .concat(stageScope)
        .map((entry) => titleCase(entry))
        .filter((entry) => entry.trim().length > 0),
    ),
  ).slice(0, 5);
}

function extractMissingDetails(
  strategyContext: HermesStrategyContext | null | undefined,
  result: HermesRespondResult,
): string[] {
  const normalizedRuleSheet = toRecord(strategyContext?.normalizedRuleSheet);
  const normalizedMissing = toStringArray(normalizedRuleSheet.missingDetails);

  if (normalizedMissing.length > 0) {
    return normalizedMissing.slice(0, 4);
  }

  if (!result.pendingClarification) {
    return [];
  }

  return [
    ...toStringArray(result.pendingClarification.missingFields),
    ...toStringArray(result.pendingClarification.workflowPreviewSteps),
  ].slice(0, 4);
}

function buildStrategyRuleItems(
  strategyContext: HermesStrategyContext | null | undefined,
  result: HermesRespondResult,
): Array<{ label: string; value: string }> {
  if (!strategyContext) {
    return [];
  }

  const normalizedRuleSheet = toRecord(strategyContext.normalizedRuleSheet);
  const executionEnvelope = toRecord(normalizedRuleSheet.executionEnvelope);
  const guardrails = toRecord(executionEnvelope.guardrails);
  const items: Array<{ label: string; value: string }> = [];
  const actionScope = extractStrategyActionScope(strategyContext, result);

  if (strategyContext.reviewState?.status === "pending") {
    items.push({
      label: "Review",
      value: "Approve the saved playbook before activation",
    });
  }

  if (actionScope.length > 0) {
    items.push({
      label: "Actions",
      value: actionScope.join(", "),
    });
  }

  if (typeof guardrails.maxActionsPerRun === "number") {
    items.push({
      label: "Run cap",
      value: String(guardrails.maxActionsPerRun),
    });
  }

  if (typeof guardrails.maxActionsPerDay === "number") {
    items.push({
      label: "Daily cap",
      value: String(guardrails.maxActionsPerDay),
    });
  }

  return items.slice(0, 4);
}

export function normalizeAgentUiBlocks(value: unknown): AgentUiBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const block = toRecord(entry);
    const type = block.type;
    if (!isAgentUiBlockType(type)) {
      return [];
    }

    return [
      {
        type,
        slot: normalizeBlockSlot(block.slot),
        priority: typeof block.priority === "number" ? block.priority : null,
        props: toRecord(block.props),
      } as AgentUiBlock,
    ];
  });
}

function buildGoalBlock(input: {
  result: HermesRespondResult;
  conversationMode: HermesConversationMode | null | undefined;
  strategyContext: HermesStrategyContext | null | undefined;
}): AgentUiBlock {
  const title =
    input.strategyContext?.mandate ||
    input.result.summary ||
    input.result.assistantText ||
    "Hermes is ready.";

  const summary =
    input.result.summary ||
    (input.conversationMode === "strategy_builder"
      ? "Keep defining the recurring strategy until its rules and schedule are clear."
      : input.conversationMode === "strategy_refinement"
        ? "This chat is editing an existing saved strategy."
        : input.conversationMode === "strategy_review"
          ? "Use this workspace to review the latest strategy behavior and tweak it if needed."
          : "Continue the portfolio conversation from here.");

  const badge =
    input.conversationMode === "strategy_builder"
      ? "building"
      : input.conversationMode === "strategy_refinement"
        ? "editing"
        : input.conversationMode === "strategy_review"
          ? "review"
          : null;

  return {
    type: "goal_strip",
    slot: getPrimarySlot(input.conversationMode),
    priority: 10,
    props: {
      eyebrow: input.conversationMode === "general_chat" ? "Goal" : "Strategy",
      title,
      status: input.result.outcome === "error" ? "blocked" : "tracking",
      summary,
      nextStep: input.result.pendingClarification
        ? "Answer the missing detail to keep going."
        : input.result.requiresConfirmation
          ? "Review the pending plan before it can move forward."
          : null,
      badge,
    },
  };
}

function buildPendingDecisionBlock(input: {
  summary: string;
  riskClass?: "low" | "medium" | "high" | null;
  helper?: string | null;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock {
  return {
    type: "pending_decision",
    slot: getInlineSlot(input.conversationMode),
    priority: 20,
    props: {
      title: "Waiting on you",
      summary: input.summary,
      risk: input.riskClass || null,
      helper: input.helper || null,
      actionLabel: "Review the staged plan below",
    },
  };
}

function buildExecutionChecklistBlock(input: {
  result: HermesRespondResult;
  conversationMode: HermesConversationMode | null | undefined;
  strategyContext: HermesStrategyContext | null | undefined;
}): AgentUiBlock | null {
  if (input.result.pendingClarification) {
    return {
      type: "execution_checklist",
      slot: getInlineSlot(input.conversationMode),
      priority: 18,
      props: {
        title: "Execution flow",
        summary: "Hermes needs one detail before it can continue the workflow.",
        items: [
          {
            id: "clarify",
            label: "Reply with the missing detail",
            detail: input.result.pendingClarification.prompt,
            status: "in_progress",
          },
          {
            id: "resume",
            label: "Hermes resumes the run",
            detail: "Once you answer, Hermes continues in the same thread context.",
            status: "pending",
          },
        ],
      },
    };
  }

  if (input.result.requiresConfirmation) {
    return {
      type: "execution_checklist",
      slot: getInlineSlot(input.conversationMode),
      priority: 18,
      props: {
        title: "Execution flow",
        summary: "The plan is staged but not applied yet.",
        items: [
          {
            id: "review",
            label: "Review the staged impact",
            detail:
              input.result.confirmationPreview?.actionSummary ||
              input.result.summary ||
              "Check the proposed change before confirming it.",
            status: "ready",
          },
          {
            id: "confirm",
            label: "Confirm or cancel",
            detail: "Sportfolio only applies the change after an explicit confirm action.",
            status: "pending",
          },
        ],
      },
    };
  }

  if (input.strategyContext?.reviewState?.status === "pending") {
    return {
      type: "execution_checklist",
      slot: "strategy_overview",
      priority: 22,
      props: {
        title: "Review flow",
        summary: "Saved strategy changes still need approval before activation.",
        items: [
          {
            id: "review_strategy",
            label: "Review the saved playbook",
            detail:
              input.strategyContext.reviewState.summary ||
              "Check the saved stages, triggers, and action scope before activation.",
            status: "ready",
          },
          {
            id: "approve_strategy",
            label: "Approve before activation",
            detail: "Leave the strategy inactive until you explicitly review and approve it.",
            status: "pending",
          },
        ],
      },
    };
  }

  return null;
}

function buildClarificationBlock(input: {
  clarification: AgentPendingClarification;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock {
  return {
    type: "clarification_card",
    slot: getInlineSlot(input.conversationMode),
    priority: 20,
    props: {
      title: "One detail is missing",
      prompt: input.clarification.prompt,
      helper: "Reply naturally and Hermes will keep going.",
      choices: input.clarification.workflowPreviewSteps || [],
    },
  };
}

function buildSourceBlock(input: {
  citations: AgentCitation[];
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock | null {
  if (input.citations.length === 0) {
    return null;
  }

  return {
    type: "source_list",
    slot: getInlineSlot(input.conversationMode),
    priority: 40,
    props: {
      title: "Sources",
      sources: input.citations.slice(0, 3).map((citation) => ({
        id: citation.id,
        title: citation.title,
        sourceName: citation.sourceName,
        retrievedAt: citation.retrievedAt,
        url: citation.url,
        factSummary: citation.factSummary,
      })),
    },
  };
}

function buildStrategyStatusOrDraftBlock(input: {
  result: HermesRespondResult;
  strategyContext: HermesStrategyContext;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock {
  const normalizedRuleSheet = toRecord(input.strategyContext.normalizedRuleSheet);
  const isDraft =
    input.strategyContext.status === "draft" &&
    (input.conversationMode === "strategy_builder" ||
      input.conversationMode === "strategy_refinement");

  if (isDraft) {
    return {
      type: "strategy_draft",
      slot: "strategy_overview",
      priority: 25,
      props: {
        title: input.strategyContext.mandate,
        summary: input.result.summary || null,
        schedule: formatScheduleLabel(input.strategyContext),
        actionScope: extractStrategyActionScope(input.strategyContext, input.result),
        missingDetails: extractMissingDetails(input.strategyContext, input.result),
      },
    };
  }

  return {
    type: "strategy_status",
    slot: "strategy_overview",
    priority: 25,
    props: {
      title: input.strategyContext.mandate,
      status: input.strategyContext.status || "draft",
      summary: input.result.summary || null,
      lastResult: input.result.assistantText || null,
    },
  };
}

function buildStrategyScheduleBlock(
  strategyContext: HermesStrategyContext | null | undefined,
): AgentUiBlock | null {
  if (!strategyContext) {
    return null;
  }

  const normalizedRuleSheet = toRecord(strategyContext.normalizedRuleSheet);
  const scheduleLabel = formatScheduleLabel(strategyContext);
  if (!scheduleLabel) {
    return null;
  }

  return {
    type: "schedule_summary",
    slot: "strategy_overview",
    priority: 35,
    props: {
      title: "Schedule",
      scheduleLabel,
      helper:
        strategyContext.status === "live"
          ? "Hermes will wake this strategy on its saved cadence."
          : "This cadence will be used when the strategy is active.",
    },
  };
}

function buildStrategyRulesBlock(input: {
  strategyContext: HermesStrategyContext | null | undefined;
  result: HermesRespondResult;
}): AgentUiBlock | null {
  const items = buildStrategyRuleItems(input.strategyContext, input.result);
  if (items.length === 0) {
    return null;
  }

  return {
    type: "rules_summary",
    slot: "strategy_overview",
    priority: 40,
    props: {
      title: "Rules",
      items,
    },
  };
}

function buildRunSummaryBlock(input: {
  result: HermesRespondResult;
  conversationMode: HermesConversationMode | null | undefined;
}): AgentUiBlock | null {
  if (!input.result.summary && !input.result.assistantText) {
    return null;
  }

  return {
    type: "run_summary",
    slot: getInlineSlot(input.conversationMode),
    priority: 60,
    props: {
      title: "Latest Hermes run",
      summary: input.result.summary || input.result.assistantText,
      status: input.result.outcome,
      transport: input.result.runtimeMetadata?.transport || null,
      createdAt: null,
      trigger: input.result.runtimeMetadata?.triggerSource || null,
    },
  };
}

export function buildFallbackAgentUiBlocks(input: {
  result: HermesRespondResult;
  conversationMode: HermesConversationMode | null | undefined;
  strategyContext: HermesStrategyContext | null | undefined;
}): AgentUiBlock[] {
  const blocks: AgentUiBlock[] = [buildGoalBlock(input)];
  const executionChecklistBlock = buildExecutionChecklistBlock(input);
  if (executionChecklistBlock) {
    blocks.push(executionChecklistBlock);
  }

  if (input.result.pendingClarification) {
    blocks.push(
      buildClarificationBlock({
        clarification: input.result.pendingClarification,
        conversationMode: input.conversationMode,
      }),
    );
  } else if (input.result.requiresConfirmation) {
    blocks.push(
      buildPendingDecisionBlock({
        conversationMode: input.conversationMode,
        summary:
          input.result.confirmationPreview?.actionSummary ||
          input.result.summary ||
          "A staged plan is waiting for review.",
        riskClass: input.result.confirmationPreview?.riskClass || null,
        helper:
          input.result.confirmationPreview?.estimatedImpact ||
          input.result.confirmationPreview?.warnings[0] ||
          null,
      }),
    );
  } else if (input.strategyContext?.reviewState?.status === "pending") {
    blocks.push(
      buildPendingDecisionBlock({
        conversationMode: input.conversationMode,
        summary:
          input.strategyContext.reviewState.summary ||
          "Review the saved stages, triggers, and action scope before activation.",
        helper: "Use the strategy Rules or Overview tab to approve the latest saved playbook.",
      }),
    );
  }

  const sourceBlock = buildSourceBlock({
    citations: input.result.citations,
    conversationMode: input.conversationMode,
  });
  if (sourceBlock) {
    blocks.push(sourceBlock);
  }

  if (input.strategyContext) {
    blocks.push(
      buildStrategyStatusOrDraftBlock({
        result: input.result,
        strategyContext: input.strategyContext,
        conversationMode: input.conversationMode,
      }),
    );

    const scheduleBlock = buildStrategyScheduleBlock(input.strategyContext);
    if (scheduleBlock) {
      blocks.push(scheduleBlock);
    }

    const rulesBlock = buildStrategyRulesBlock({
      strategyContext: input.strategyContext,
      result: input.result,
    });
    if (rulesBlock) {
      blocks.push(rulesBlock);
    }
  }

  const runBlock = buildRunSummaryBlock({
    result: input.result,
    conversationMode: input.conversationMode,
  });
  if (runBlock) {
    blocks.push(runBlock);
  }

  return blocks;
}

export function materializeAgentUiBlocks(input: {
  result: HermesRespondResult;
  conversationMode: HermesConversationMode | null | undefined;
  strategyContext: HermesStrategyContext | null | undefined;
}): AgentUiBlock[] {
  return input.result.uiBlocks && input.result.uiBlocks.length > 0
    ? normalizeAgentUiBlocks(input.result.uiBlocks)
    : buildFallbackAgentUiBlocks(input);
}
