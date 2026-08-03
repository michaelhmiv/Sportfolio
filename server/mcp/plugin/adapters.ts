import { z } from "zod";
import {
  createDefaultPublicMcpDependencies,
  executePublicTool,
  getPublicToolDefinition,
  type PublicMcpDependencies,
} from "../public-tool-registry";
import { getPluginOAuthConfig } from "../../auth/plugin-oauth-config";
import { pluginMcpAuthError } from "../../auth/plugin-auth-challenge";
import type { PluginMcpContext } from "./context";
import { getPluginV1ToolPolicy } from "./capability-policy";
import { assertNoRestrictedPluginFields, sanitizePluginValue } from "./sanitizer";

type RawSchema = Record<string, z.ZodTypeAny>;

export type PluginToolAdapter = {
  name: string;
  sourceTool: string;
  title: string;
  description: string;
};

export const PLUGIN_TOOL_ADAPTERS: readonly PluginToolAdapter[] = [
  {
    name: "search_sportfolio_docs",
    sourceTool: "search_docs",
    title: "Search Sportfolio documentation",
    description: "Use when the user asks how Sportfolio works or needs help finding a documented rule. Returns matching public documentation. Do not use for connected-account data.",
  },
  {
    name: "get_sportfolio_doc",
    sourceTool: "get_doc_article",
    title: "Read a Sportfolio document",
    description: "Use after identifying a documentation article. Returns one public Sportfolio guide. Do not use for player or account information.",
  },
  {
    name: "search_players",
    sourceTool: "search_players",
    title: "Search Sportfolio players",
    description: "Use to resolve a player by name, team, position, or sport. Returns public player matches. Do not use to inspect the connected user's holdings.",
  },
  {
    name: "get_player_overview",
    sourceTool: "get_player_detail",
    title: "Get player overview",
    description: "Use for a specific player's public Sportfolio profile, performance, and market context. Do not use to execute a trade.",
  },
  {
    name: "get_player_recent_games",
    sourceTool: "get_player_recent_games",
    title: "Get player recent games",
    description: "Use for a specific player's recent game log. Returns bounded recent performance data. Do not use for all games on a date.",
  },
  {
    name: "get_games",
    sourceTool: "get_games_today",
    title: "Get scheduled games",
    description: "Use for Sportfolio-supported games on a date or in a sport. Returns game schedule and status information. Do not use for the user's personalized lineup impact.",
  },
  {
    name: "get_my_dashboard",
    sourceTool: "get_dashboard_overview",
    title: "Get my Sportfolio dashboard",
    description: "Use for a broad connected-account overview spanning the user's virtual portfolio, balance, boosts, scouts, and watchlists.",
  },
  {
    name: "get_my_portfolio",
    sourceTool: "get_portfolio_summary",
    title: "Get my virtual portfolio",
    description: "Use when the connected user asks about virtual holdings, concentration, or portfolio status. This is not financial investment data.",
  },
  {
    name: "get_my_portfolio_history",
    sourceTool: "get_portfolio_history",
    title: "Get my portfolio history",
    description: "Use for historical snapshots or virtual performance over a supported time range. Do not present virtual changes as real-money gains or losses.",
  },
  {
    name: "get_my_balance",
    sourceTool: "get_balance_state",
    title: "Get my virtual balance",
    description: "Use for the connected user's virtual Sportfolio balance and capacity state. The balance has no cash value and cannot be withdrawn.",
  },
  {
    name: "get_my_watchlists",
    sourceTool: "list_watchlists",
    title: "Get my watchlists",
    description: "Use to list the connected user's saved player watchlists. This tool does not create, edit, or delete watchlists.",
  },
  {
    name: "get_my_watchlist",
    sourceTool: "get_watchlist_items",
    title: "Get one of my watchlists",
    description: "Use after a watchlist is identified to list its player items. This tool is read-only.",
  },
  {
    name: "get_my_daily_boosts",
    sourceTool: "list_daily_boosts",
    title: "Get my daily boosts",
    description: "Use to review the connected user's daily virtual boosts for a date. This tool cannot assign or remove boosts.",
  },
  {
    name: "get_my_boost_history",
    sourceTool: "list_daily_boost_history",
    title: "Get my boost history",
    description: "Use for recent virtual boost results and payouts. Returns bounded history and does not modify boosts.",
  },
  {
    name: "get_my_collections",
    sourceTool: "list_collections",
    title: "Get my collections",
    description: "Use to review collection progress for the connected account. Returns tracked virtual collection state.",
  },
  {
    name: "get_my_collection",
    sourceTool: "get_collection_detail",
    title: "Get my collection details",
    description: "Use for one identified collection to review progress and owned players. This tool does not alter allocations.",
  },
  {
    name: "get_my_milestones",
    sourceTool: "list_milestones",
    title: "Get my milestones",
    description: "Use to review the connected user's Sportfolio milestone progress. This tool does not claim or celebrate milestones.",
  },
  {
    name: "get_my_news_digest",
    sourceTool: "get_news_digest",
    title: "Get my Sportfolio news digest",
    description: "Use for the connected user's compiled Sportfolio news digest. This tool does not mark stories as read.",
  },
  {
    name: "get_my_game_insights",
    sourceTool: "get_game_insights",
    title: "Get my game insights",
    description: "Use to connect scheduled games with the user's holdings and virtual boosts. This is personalized read-only gameplay analysis.",
  },
  {
    name: "review_my_sportfolio_setup",
    sourceTool: "review_setup",
    title: "Review my Sportfolio setup",
    description: "Use for a broad read-only review of the connected user's Sportfolio setup. Recommendations must remain within virtual gameplay context.",
  },
  {
    name: "find_my_boost_candidates",
    sourceTool: "list_boost_candidates",
    title: "Find my boost candidates",
    description: "Use to rank read-only candidate ideas for the user's daily virtual boosts. This tool cannot assign a boost.",
  },
  {
    name: "find_my_scout_opportunities",
    sourceTool: "list_scout_opportunities",
    title: "Find my scout opportunities",
    description: "Use to identify read-only scouting opportunities for the connected account. This tool cannot scout or allocate shares.",
  },
] as const;

const envelopeOutputSchema: RawSchema = {
  summary: z.string().max(1000),
  data: z.unknown(),
  warnings: z.array(z.string().max(500)).max(20),
};

function summaryFromResult(result: unknown, fallback: string): string {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const candidate = result as Record<string, unknown>;
    for (const key of ["summary", "message", "replyText", "status"]) {
      if (typeof candidate[key] === "string" && candidate[key].trim()) {
        return candidate[key].slice(0, 1000);
      }
    }
  }
  return fallback;
}

export function getPluginToolInputSchema(adapter: PluginToolAdapter): RawSchema {
  return (getPublicToolDefinition(adapter.sourceTool)?.inputSchema || {}) as RawSchema;
}

export function getPluginToolOutputSchema(): RawSchema {
  return envelopeOutputSchema;
}

export async function executePluginToolAdapter(
  adapter: PluginToolAdapter,
  context: PluginMcpContext,
  args: Record<string, unknown>,
  deps: PublicMcpDependencies = createDefaultPublicMcpDependencies(),
) {
  const policy = getPluginV1ToolPolicy(adapter.name);
  if (!policy) {
    throw new Error(`Marketplace tool is not allowlisted: ${adapter.name}`);
  }

  if (policy.access === "oauth" && !context.auth) {
    return pluginMcpAuthError(getPluginOAuthConfig(), {
      error: "invalid_token",
      description: "Connect your Sportfolio account to use this tool.",
    });
  }

  const userId = context.auth?.userId || "plugin-public-user";
  const raw = await executePublicTool({ userId, deps }, adapter.sourceTool, args);
  const data = sanitizePluginValue(raw);
  assertNoRestrictedPluginFields(data);

  const structuredContent = {
    summary: summaryFromResult(data, `${adapter.title} completed.`),
    data,
    warnings: [],
  };

  return {
    content: [{ type: "text" as const, text: structuredContent.summary }],
    structuredContent,
  };
}
