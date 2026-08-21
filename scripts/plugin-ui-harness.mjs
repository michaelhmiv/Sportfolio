import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, "..");
const generated = await readFile(
  join(projectRoot, "server/mcp/plugin/ui/generated-widget.ts"),
  "utf8",
);
const marker = "export const SPORTFOLIO_WIDGET_HTML_TEMPLATE = ";
const exportStart = generated.indexOf(marker);
if (exportStart < 0) throw new Error("Generated Sportfolio widget HTML was not found.");
const exportLine = generated.slice(exportStart).split(/\r?\n/, 1)[0];
const template = JSON.parse(exportLine.slice(marker.length).trim().replace(/;\s*$/, ""));

const marketMovers = {
  view: "market_movers",
  asOf: "2026-08-21T21:45:03.285Z",
  data: {
    category: "gainers",
    range: "1D",
    sport: null,
    returned: 6,
    items: [
      ["Layne Riggs", "nascar_4446", "NTS", "NASCAR", 14.1411, 26.2599, 59.03],
      ["Stephen Mallozzi", "nascar_4443", "NTS", "NASCAR", 14.2814, 18.8139, 59.36],
      ["Thomas Annunziata", "nascar_4493", "NTS", "NASCAR", 14.1411, 18.2367, 59.03],
      ["MacKenzie Gore", "mlb_669022", "TEX", "MLB", 12.3456, 18.1393, 33.01],
      ["Aaron Civale", "mlb_650644", "CHC", "MLB", 12.3456, 18.1393, 33.01],
      ["Rafael Flores", "mlb_804668", "PIT", "MLB", 12.3456, 18.1393, 33.01],
    ].map(([displayName, playerId, team, sport, currentPrice, changePercent, volume]) => ({
      player: { displayName, playerId, team, sport, imageUrl: null },
      marketStatus: "active",
      currentPrice,
      changePercent,
      volume,
      totalTrades: 5,
      liquidity: 763.62,
    })),
  },
};

const output = { structuredContent: marketMovers };
const playerMarket = {
  structuredContent: {
    view: "player_market",
    asOf: marketMovers.asOf,
    data: {
      player: {
        displayName: "MacKenzie Gore",
        playerId: "mlb_669022",
        team: "TEX",
        position: "P",
        sport: "MLB",
        imageUrl: null,
      },
      market: {
        status: "priced",
        currentPrice: 12.345555555555555,
        liquidity: 666.66,
        volume: 33.01,
        totalTrades: 3,
      },
      history: { range: "1D", points: [], percentageChange: 0 },
      userHolding: null,
      capabilities: { authenticated: false, canTrade: false, canManageLiquidity: false },
    },
  },
};
const bridge = `<script>
  window.openai = {
    theme: "light",
    displayMode: "inline",
    callTool: async (name) => name === "render_player_market" ? (${JSON.stringify(playerMarket)}) : (${JSON.stringify(output)}),
  };
  setTimeout(() => window.postMessage({ method: "ui/notifications/tool-result", params: ${JSON.stringify(output)} }, "*"), 350);
</script>`;
const html = template.replace('<script type="module">', `${bridge}\n<script type="module">`);
const port = Number(process.env.PLUGIN_UI_HARNESS_PORT || 4173);

createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}).listen(port, "127.0.0.1", () => {
  console.log(
    `Sportfolio plugin UI harness listening at http://127.0.0.1:${port}/ (${html.length} HTML bytes)`,
  );
});
