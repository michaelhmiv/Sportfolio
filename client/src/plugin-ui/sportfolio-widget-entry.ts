import {
  asRecord,
  getHostSnapshot,
  initializeMcpApp,
  subscribeHostMessages,
  type JsonRecord,
} from "./openai-host";

const SPORTS_VIEWS = new Set(["score_slate", "live_event", "game_insights"]);
const MARKET_PORTFOLIO_VIEWS = new Set(["player_market", "portfolio"]);
const GAMEPLAY_VIEWS = new Set(["scouting", "boosts", "watchlist"]);
const OVERVIEW_VIEWS = new Set(["dashboard", "collections", "rankings"]);

export const WIDGET_HYDRATION_TIMEOUT_MS = 12_000;

type Surface = "action" | "sports" | "market-portfolio" | "gameplay" | "overview" | "legacy";

export function viewFromToolOutput(value: unknown): string {
  const root = asRecord(value);
  const structured = asRecord(root.structuredContent);
  if (typeof structured.view === "string") return structured.view;
  if (typeof root.view === "string") return root.view;
  const data = asRecord(root.data);
  return typeof data.view === "string" ? data.view : "";
}

export function surfaceForView(view: string): Surface | null {
  if (!view) return null;
  if (view === "action_review") return "action";
  if (SPORTS_VIEWS.has(view)) return "sports";
  if (MARKET_PORTFOLIO_VIEWS.has(view)) return "market-portfolio";
  if (GAMEPLAY_VIEWS.has(view)) return "gameplay";
  if (OVERVIEW_VIEWS.has(view)) return "overview";
  return "legacy";
}

function showBootstrapStatus(message: string, error = false): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.textContent = message;
  root.setAttribute("role", error ? "alert" : "status");
  root.style.cssText = [
    "font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "padding:16px",
    "font-size:13px",
    `color:${error ? "#b42318" : "#626a79"}`,
  ].join(";");
}

function clearBootstrapStatus(): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.textContent = "";
  root.removeAttribute("role");
  root.removeAttribute("style");
}

let selectedSurface: Surface | null = null;
let loadingSurface: Promise<unknown> | null = null;
let hydrationTimer: number | null = null;

function clearHydrationTimer(): void {
  if (hydrationTimer == null) return;
  window.clearTimeout(hydrationTimer);
  hydrationTimer = null;
}

function importSurface(surface: Surface): Promise<unknown> {
  switch (surface) {
    case "action":
      return import("./sportfolio-action-widget");
    case "sports":
      return import("./sportfolio-sports-widget");
    case "market-portfolio":
      return import("./sportfolio-market-portfolio-widget");
    case "gameplay":
      return import("./sportfolio-gameplay-widget");
    case "overview":
      return import("./sportfolio-overview-widget");
    case "legacy":
      return import("./sportfolio-widget-v2");
  }
}

function loadView(view: string): void {
  const surface = surfaceForView(view);
  if (!surface || selectedSurface) return;
  selectedSurface = surface;
  clearHydrationTimer();
  clearBootstrapStatus();
  loadingSurface = importSurface(surface).catch((error) => {
    console.error("Sportfolio widget failed to load", error);
    showBootstrapStatus("Sportfolio could not load this interactive view. Please try the action again.", true);
    return null;
  });
}

function routeSnapshot(): void {
  loadView(viewFromToolOutput(getHostSnapshot().toolOutput));
}

function startHydrationTimeout(): void {
  clearHydrationTimer();
  hydrationTimer = window.setTimeout(() => {
    hydrationTimer = null;
    if (selectedSurface) return;
    const output = getHostSnapshot().toolOutput;
    const hasOutput = Object.keys(asRecord(output)).length > 0;
    showBootstrapStatus(
      hasOutput
        ? "Sportfolio received a response that cannot be displayed here. Ask ChatGPT to reopen the action review."
        : "Sportfolio did not receive the data needed to display this card. Please try the action again.",
      true,
    );
  }, WIDGET_HYDRATION_TIMEOUT_MS);
}

showBootstrapStatus("Loading Sportfolio…");
routeSnapshot();
if (!selectedSurface) startHydrationTimeout();

subscribeHostMessages((message: JsonRecord) => {
  if (
    message.method === "ui/notifications/tool-result" ||
    message.method === "openai:set_globals"
  ) {
    routeSnapshot();
  }
});

void initializeMcpApp().then(() => {
  // Some hosts populate compatibility globals as part of initialization rather than
  // before the iframe starts. Re-check after initialization while retaining a bounded
  // fallback so a malformed/missing result cannot leave the card loading forever.
  routeSnapshot();
});

export function getLoadedSurfaceForTest(): Surface | null {
  return selectedSurface;
}

export function getLoadingSurfaceForTest(): Promise<unknown> | null {
  return loadingSurface;
}
