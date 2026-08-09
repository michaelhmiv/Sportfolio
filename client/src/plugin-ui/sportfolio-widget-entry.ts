import { asRecord, getHostSnapshot } from "./openai-host";

const SPORTS_VIEWS = new Set(["score_slate", "live_event", "game_insights"]);
const MARKET_PORTFOLIO_VIEWS = new Set(["player_market", "portfolio"]);
const GAMEPLAY_VIEWS = new Set(["scouting", "boosts", "watchlist"]);

function initialView(): string {
  const root = asRecord(getHostSnapshot().toolOutput);
  const structured = asRecord(root.structuredContent);
  if (typeof structured.view === "string") return structured.view;
  if (typeof root.view === "string") return root.view;
  const data = asRecord(root.data);
  return typeof data.view === "string" ? data.view : "";
}

const view = initialView();
if (view === "action_review") {
  void import("./sportfolio-action-widget");
} else if (SPORTS_VIEWS.has(view)) {
  void import("./sportfolio-sports-widget");
} else if (MARKET_PORTFOLIO_VIEWS.has(view)) {
  void import("./sportfolio-market-portfolio-widget");
} else if (GAMEPLAY_VIEWS.has(view)) {
  void import("./sportfolio-gameplay-widget");
} else {
  void import("./sportfolio-widget-v2");
}
