import type {
  PluginExcludedCapability,
  PluginMarketplaceContract,
  PluginToolPolicy,
} from "./types";

const publicTool = (name: string): PluginToolPolicy => ({
  name,
  access: "public",
  dataClassification: "public",
  readOnly: true,
  openWorld: false,
  destructive: false,
});

const connectedTool = (
  name: string,
  dataClassification: Exclude<PluginToolPolicy["dataClassification"], "public">,
): PluginToolPolicy => ({
  name,
  access: "oauth",
  dataClassification,
  readOnly: true,
  openWorld: false,
  destructive: false,
});

export const PLUGIN_V1_TOOLS = [
  publicTool("search_sportfolio_docs"),
  publicTool("get_sportfolio_doc"),
  publicTool("search_players"),
  publicTool("get_player_overview"),
  publicTool("get_player_recent_games"),
  publicTool("get_games"),
  connectedTool("get_my_dashboard", "user_gameplay"),
  connectedTool("get_my_portfolio", "user_portfolio"),
  connectedTool("get_my_portfolio_history", "user_portfolio"),
  connectedTool("get_my_balance", "user_portfolio"),
  connectedTool("get_my_watchlists", "user_preferences"),
  connectedTool("get_my_watchlist", "user_preferences"),
  connectedTool("get_my_daily_boosts", "user_gameplay"),
  connectedTool("get_my_boost_history", "user_gameplay"),
  connectedTool("get_my_collections", "user_gameplay"),
  connectedTool("get_my_collection", "user_gameplay"),
  connectedTool("get_my_milestones", "user_gameplay"),
  connectedTool("get_my_game_insights", "user_gameplay"),
  connectedTool("find_my_boost_candidates", "user_gameplay"),
  connectedTool("find_my_scout_opportunities", "user_gameplay"),
] as const satisfies readonly PluginToolPolicy[];

export const PLUGIN_V1_EXCLUDED_CAPABILITIES = [
  { name: "list_api_tokens", reason: "account_security_management" },
  { name: "revoke_api_token", reason: "account_security_management" },
  { name: "update_username", reason: "user_profile_mutation" },
  { name: "update_profile_image", reason: "user_profile_mutation" },
  { name: "complete_onboarding", reason: "user_profile_mutation" },
  { name: "celebrate_milestone", reason: "user_profile_mutation" },
  { name: "redeem_premium", reason: "billing_or_purchase" },
  { name: "confirm_pending_action", reason: "gameplay_mutation" },
  { name: "cancel_pending_action", reason: "gameplay_mutation" },
  { name: "stage_*", reason: "gameplay_mutation" },
  { name: "billing_*", reason: "billing_or_purchase" },
  { name: "checkout_*", reason: "billing_or_purchase" },
  { name: "admin_*", reason: "admin_or_internal" },
  { name: "internal_*", reason: "admin_or_internal" },
] as const satisfies readonly PluginExcludedCapability[];

export const PLUGIN_MARKETPLACE_V1_CONTRACT = {
  version: "v1",
  endpoint: "/mcp/plugin",
  tools: PLUGIN_V1_TOOLS,
  excluded: PLUGIN_V1_EXCLUDED_CAPABILITIES,
} as const satisfies PluginMarketplaceContract;

export function getPluginV1ToolPolicy(name: string): PluginToolPolicy | null {
  return PLUGIN_V1_TOOLS.find((tool) => tool.name === name) || null;
}

export function isPluginV1ToolAllowed(name: string): boolean {
  return getPluginV1ToolPolicy(name) !== null;
}
