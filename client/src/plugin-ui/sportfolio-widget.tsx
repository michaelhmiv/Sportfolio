import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

type JsonRecord = Record<string, unknown>;
type MarketSide = "buy" | "sell";

type PresentationPayload = {
  view: "player_market" | "trade_preview" | "portfolio" | "market_movers" | "liquidity";
  asOf: string;
  data: JsonRecord;
  warnings: string[];
};

type PendingRpc = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: number;
};

declare global {
  interface Window {
    openai?: {
      toolOutput?: unknown;
      toolResponseMetadata?: unknown;
      widgetState?: unknown;
      theme?: "light" | "dark";
      locale?: string;
      displayMode?: string;
      callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
      requestDisplayMode?: (mode: "inline" | "fullscreen" | "pip") => Promise<unknown>;
      sendFollowUpMessage?: (input: { prompt: string }) => Promise<unknown>;
      setWidgetState?: (state: unknown) => Promise<unknown> | unknown;
    };
  }
}

const CSS = `
:root {
  color-scheme: light dark;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --sf-bg: light-dark(#f7f8fb, #111318);
  --sf-panel: light-dark(#ffffff, #191c23);
  --sf-panel-2: light-dark(#f1f3f7, #222630);
  --sf-text: light-dark(#151821, #f5f7fb);
  --sf-muted: light-dark(#626a79, #a7aebb);
  --sf-border: light-dark(#dfe3ea, #303642);
  --sf-accent: light-dark(#3157d5, #8da8ff);
  --sf-positive: light-dark(#087a4b, #4bd59a);
  --sf-negative: light-dark(#b42318, #ff8d86);
  --sf-warning: light-dark(#8a4b08, #ffc675);
}
* { box-sizing: border-box; }
html, body, #root { margin: 0; min-height: 100%; background: transparent; color: var(--sf-text); }
body { padding: 0; }
button, input, select { font: inherit; }
.sf-shell { width: 100%; padding: 12px; }
.sf-panel { background: var(--sf-panel); border: 1px solid var(--sf-border); border-radius: 18px; overflow: hidden; }
.sf-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid var(--sf-border); }
.sf-title { margin: 0; font-size: 18px; line-height: 1.2; }
.sf-subtitle { color: var(--sf-muted); font-size: 12px; margin-top: 4px; }
.sf-content { padding: 16px; }
.sf-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sf-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 10px; }
.sf-stat { background: var(--sf-panel-2); border: 1px solid var(--sf-border); border-radius: 14px; padding: 12px; min-width: 0; }
.sf-label { color: var(--sf-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
.sf-value { margin-top: 4px; font-weight: 720; font-size: 17px; overflow-wrap: anywhere; }
.sf-avatar { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; background: var(--sf-panel-2); border: 1px solid var(--sf-border); }
.sf-avatar-fallback { display: grid; place-items: center; font-weight: 800; color: var(--sf-accent); }
.sf-button { appearance: none; border: 1px solid var(--sf-border); background: var(--sf-panel-2); color: var(--sf-text); border-radius: 12px; min-height: 40px; padding: 8px 12px; cursor: pointer; font-weight: 650; }
.sf-button:hover { border-color: var(--sf-accent); }
.sf-button:focus-visible, .sf-input:focus-visible, .sf-select:focus-visible { outline: 3px solid color-mix(in srgb, var(--sf-accent) 35%, transparent); outline-offset: 2px; }
.sf-button[disabled] { cursor: not-allowed; opacity: .55; }
.sf-primary { background: var(--sf-accent); color: light-dark(#fff, #10131a); border-color: transparent; }
.sf-danger { color: var(--sf-negative); }
.sf-segment { display: inline-flex; padding: 3px; border-radius: 12px; background: var(--sf-panel-2); border: 1px solid var(--sf-border); }
.sf-segment button { border: 0; background: transparent; color: var(--sf-muted); border-radius: 9px; padding: 7px 10px; cursor: pointer; }
.sf-segment button[aria-pressed="true"] { background: var(--sf-panel); color: var(--sf-text); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.sf-input, .sf-select { width: 100%; min-height: 42px; border: 1px solid var(--sf-border); border-radius: 12px; background: var(--sf-panel); color: var(--sf-text); padding: 8px 10px; }
.sf-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.sf-field label { display: block; margin-bottom: 5px; color: var(--sf-muted); font-size: 12px; }
.sf-positive { color: var(--sf-positive); }
.sf-negative { color: var(--sf-negative); }
.sf-muted { color: var(--sf-muted); }
.sf-warning { color: var(--sf-warning); }
.sf-section { margin-top: 16px; }
.sf-section-title { margin: 0 0 8px; font-size: 14px; }
.sf-chart { width: 100%; height: 180px; background: var(--sf-panel-2); border: 1px solid var(--sf-border); border-radius: 14px; overflow: hidden; }
.sf-chart svg { width: 100%; height: 100%; display: block; }
.sf-table { width: 100%; border-collapse: collapse; }
.sf-table th, .sf-table td { padding: 10px 8px; border-bottom: 1px solid var(--sf-border); text-align: left; font-size: 13px; vertical-align: middle; }
.sf-table th { color: var(--sf-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
.sf-scroll { overflow-x: auto; }
.sf-carousel { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(210px, 78%); gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 4px; }
.sf-card { scroll-snap-align: start; background: var(--sf-panel-2); border: 1px solid var(--sf-border); border-radius: 15px; padding: 14px; }
.sf-notice { border: 1px solid var(--sf-border); border-radius: 12px; padding: 10px 12px; background: var(--sf-panel-2); font-size: 13px; }
.sf-notice + .sf-notice { margin-top: 8px; }
.sf-error { border-color: color-mix(in srgb, var(--sf-negative) 45%, var(--sf-border)); color: var(--sf-negative); }
.sf-success { border-color: color-mix(in srgb, var(--sf-positive) 45%, var(--sf-border)); color: var(--sf-positive); }
.sf-loading { min-height: 160px; display: grid; place-items: center; color: var(--sf-muted); }
.sf-footer { padding: 10px 16px; border-top: 1px solid var(--sf-border); color: var(--sf-muted); font-size: 11px; }
@media (max-width: 540px) {
  .sf-shell { padding: 6px; }
  .sf-header, .sf-content { padding: 12px; }
  .sf-grid { grid-template-columns: 1fr 1fr; }
  .sf-table th:nth-child(3), .sf-table td:nth-child(3) { display: none; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }
`;

const pendingRpc = new Map<number, PendingRpc>();
let rpcSequence = 1;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  const resolved = typeof value === "number" ? value : Number(value);
  return Number.isFinite(resolved) ? resolved : fallback;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function formatMoney(value: unknown): string {
  return new Intl.NumberFormat(window.openai?.locale || undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(numberValue(value));
}

function formatNumber(value: unknown, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat(window.openai?.locale || undefined, {
    maximumFractionDigits,
  }).format(numberValue(value));
}

function formatPercent(value: unknown): string {
  const resolved = numberValue(value);
  return `${resolved >= 0 ? "+" : ""}${resolved.toFixed(2)}%`;
}

function formatTime(value: unknown): string {
  const text = stringValue(value);
  if (!text) return "Unknown";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString(window.openai?.locale || undefined);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function normalizePresentation(value: unknown): PresentationPayload | null {
  const root = record(value);
  const structured = record(root.structuredContent);
  const candidate = stringValue(structured.view)
    ? structured
    : stringValue(root.view)
      ? root
      : record(root.data);
  const view = stringValue(candidate.view);
  if (!["player_market", "trade_preview", "portfolio", "market_movers", "liquidity"].includes(view)) {
    return null;
  }
  return {
    view: view as PresentationPayload["view"],
    asOf: stringValue(candidate.asOf, new Date().toISOString()),
    data: record(candidate.data),
    warnings: array(candidate.warnings).filter((entry): entry is string => typeof entry === "string"),
  };
}

function unwrapBusinessResult(value: unknown): JsonRecord {
  const root = record(value);
  const structured = Object.keys(record(root.structuredContent)).length
    ? record(root.structuredContent)
    : root;
  return Object.prototype.hasOwnProperty.call(structured, "data")
    ? record(structured.data)
    : structured;
}

function callParent(method: string, params: JsonRecord): Promise<unknown> {
  const id = rpcSequence++;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingRpc.delete(id);
      reject(new Error(`Host request timed out: ${method}`));
    }, 20_000);
    pendingRpc.set(id, { resolve, reject, timer });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  });
}

async function callTool(name: string, args: JsonRecord): Promise<unknown> {
  if (window.openai?.callTool) {
    return window.openai.callTool(name, args);
  }
  return callParent("tools/call", { name, arguments: args });
}

function usePresentation(): [PresentationPayload | null, (payload: PresentationPayload) => void] {
  const [payload, setPayload] = useState<PresentationPayload | null>(() =>
    normalizePresentation(window.openai?.toolOutput),
  );

  useEffect(() => {
    const globalsHandler = (event: Event) => {
      const detail = record((event as CustomEvent<unknown>).detail);
      const globals = Object.keys(record(detail.globals)).length ? record(detail.globals) : detail;
      const next = normalizePresentation(globals.toolOutput);
      if (next) setPayload(next);
    };

    const messageHandler = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const message = record(event.data);
      const id = numberValue(message.id, -1);
      if (id >= 0 && pendingRpc.has(id) && ("result" in message || "error" in message)) {
        const pending = pendingRpc.get(id);
        if (!pending) return;
        window.clearTimeout(pending.timer);
        pendingRpc.delete(id);
        if (message.error) pending.reject(new Error(stringValue(record(message.error).message, "Host error")));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === "ui/notifications/tool-result") {
        const params = record(message.params);
        const next = normalizePresentation(params.result ?? params);
        if (next) setPayload(next);
      }
    };

    window.addEventListener("openai:set_globals", globalsHandler);
    window.addEventListener("message", messageHandler);
    void callParent("ui/initialize", {
      protocolVersion: "2025-06-18",
      appInfo: { name: "sportfolio-plugin-ui", version: "1.0.0" },
      capabilities: {},
    }).catch(() => undefined);

    return () => {
      window.removeEventListener("openai:set_globals", globalsHandler);
      window.removeEventListener("message", messageHandler);
    };
  }, []);

  const update = useCallback((next: PresentationPayload) => {
    setPayload(next);
    void window.openai?.setWidgetState?.({ view: next.view, asOf: next.asOf }).catch?.(() => undefined);
  }, []);

  return [payload, update];
}

function PlayerIdentity({ player }: { player: JsonRecord }) {
  const displayName = stringValue(player.displayName, "Unknown player");
  const imageUrl = stringValue(player.imageUrl);
  return (
    <div className="sf-row">
      {imageUrl ? (
        <img className="sf-avatar" src={imageUrl} alt="" />
      ) : (
        <div className="sf-avatar sf-avatar-fallback" aria-hidden="true">
          {initials(displayName)}
        </div>
      )}
      <div>
        <h2 className="sf-title">{displayName}</h2>
        <div className="sf-subtitle">
          {[stringValue(player.team), stringValue(player.position), stringValue(player.sport)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </div>
  );
}

function PriceChart({ points }: { points: unknown[] }) {
  const values = points
    .map((entry) => record(entry))
    .map((entry) => ({ price: numberValue(entry.price, Number.NaN), timestamp: stringValue(entry.timestamp) }))
    .filter((entry) => Number.isFinite(entry.price));

  const polyline = useMemo(() => {
    if (values.length < 2) return "";
    const prices = values.map((entry) => entry.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = Math.max(max - min, Number.EPSILON);
    return values
      .map((entry, index) => {
        const x = (index / Math.max(values.length - 1, 1)) * 620 + 10;
        const y = 165 - ((entry.price - min) / span) * 145;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values]);

  if (!polyline) {
    return <div className="sf-chart sf-loading">Price history is not available yet.</div>;
  }

  return (
    <div className="sf-chart" role="img" aria-label={`Price history with ${values.length} points`}>
      <svg viewBox="0 0 640 180" preserveAspectRatio="none">
        <polyline fill="none" stroke="var(--sf-accent)" strokeWidth="3" points={polyline} />
      </svg>
    </div>
  );
}

function Notice({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "error" | "success" }) {
  return <div className={`sf-notice ${tone === "error" ? "sf-error" : tone === "success" ? "sf-success" : ""}`}>{children}</div>;
}

function PendingPanel({
  pending,
  onComplete,
}: {
  pending: JsonRecord;
  onComplete?: () => Promise<void> | void;
}) {
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const threadId = stringValue(pending.threadId);
  const pendingBundleId = stringValue(pending.pendingBundleId);
  const bundle = record(pending.pendingBundle);
  const warnings = array(pending.warnings).filter((entry): entry is string => typeof entry === "string");

  const finalize = async (tool: "confirm_pending_action" | "cancel_pending_action") => {
    if (!threadId || !pendingBundleId) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await callTool(tool, { threadId, pendingBundleId });
      const body = unwrapBusinessResult(result);
      setStatus(stringValue(body.summary, tool === "confirm_pending_action" ? "Action confirmed." : "Action canceled."));
      await onComplete?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The pending action could not be finalized.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sf-section" aria-label="Pending action review">
      <h3 className="sf-section-title">Review pending action</h3>
      <Notice>
        <strong>{stringValue(pending.summary, stringValue(bundle.summary, "Sportfolio action ready for confirmation"))}</strong>
        {stringValue(bundle.estimatedImpact) ? <div className="sf-muted">{stringValue(bundle.estimatedImpact)}</div> : null}
      </Notice>
      {warnings.map((warning) => (
        <Notice key={warning}>{warning}</Notice>
      ))}
      <div className="sf-row" style={{ marginTop: 10 }}>
        <button className="sf-button sf-primary" disabled={busy || !threadId || !pendingBundleId} onClick={() => void finalize("confirm_pending_action")}>
          Confirm
        </button>
        <button className="sf-button" disabled={busy || !threadId || !pendingBundleId} onClick={() => void finalize("cancel_pending_action")}>
          Cancel
        </button>
      </div>
      {status ? <Notice tone={status.toLowerCase().includes("could not") ? "error" : "success"}>{status}</Notice> : null}
    </section>
  );
}

function PlayerMarket({ payload, setPayload }: { payload: PresentationPayload; setPayload: (payload: PresentationPayload) => void }) {
  const data = payload.data;
  const player = record(data.player);
  const market = record(data.market);
  const history = record(data.history);
  const holding = record(data.userHolding);
  const [side, setSide] = useState<MarketSide>("buy");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<JsonRecord>({});
  const [pending, setPending] = useState<JsonRecord>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const quoteRequest = useRef(0);
  const range = stringValue(history.range, "1D");
  const isFullscreen = window.openai?.displayMode === "fullscreen";
  const change = numberValue(history.percentageChange);

  const refresh = useCallback(async () => {
    const result = await callTool("render_player_market", {
      playerId: stringValue(player.playerId),
      range,
    });
    const next = normalizePresentation(result);
    if (next) setPayload(next);
  }, [player.playerId, range, setPayload]);

  useEffect(() => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setQuote({});
      return;
    }
    const requestId = ++quoteRequest.current;
    const timer = window.setTimeout(async () => {
      try {
        const result = await callTool("get_amm_trade_quote", {
          playerId: stringValue(player.playerId),
          type: side,
          amount: numericAmount,
        });
        if (requestId !== quoteRequest.current) return;
        const body = unwrapBusinessResult(result);
        setQuote(Object.keys(record(body.quote)).length ? record(body.quote) : body);
        setStatus("");
      } catch (error) {
        if (requestId !== quoteRequest.current) return;
        setQuote({});
        setStatus(error instanceof Error ? error.message : "Quote unavailable.");
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [amount, side, player.playerId]);

  const stage = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await callTool(side === "buy" ? "stage_market_buy" : "stage_market_sell", {
        playerId: stringValue(player.playerId),
        ...(side === "buy" ? { amount: numericAmount } : { shares: numericAmount }),
      });
      const body = unwrapBusinessResult(result);
      setPending(body);
      setStatus(stringValue(body.summary, "Trade staged for confirmation."));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Trade could not be staged.");
    } finally {
      setBusy(false);
    }
  };

  const changeRange = async (nextRange: string) => {
    setBusy(true);
    try {
      const result = await callTool("render_player_market", {
        playerId: stringValue(player.playerId),
        range: nextRange,
      });
      const next = normalizePresentation(result);
      if (next) setPayload(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sf-panel">
      <header className="sf-header">
        <PlayerIdentity player={player} />
        <div style={{ textAlign: "right" }}>
          <div className="sf-label">Market price</div>
          <div className="sf-value">{formatMoney(market.currentPrice)}</div>
          <div className={change > 0 ? "sf-positive" : change < 0 ? "sf-negative" : "sf-muted"}>{formatPercent(change)}</div>
        </div>
      </header>
      <div className="sf-content">
        {stringValue(market.status) !== "active" ? (
          <Notice>{stringValue(market.statusMessage, "This player market is not active yet.")}</Notice>
        ) : null}
        <div className="sf-between" style={{ marginBottom: 10 }}>
          <div className="sf-segment" aria-label="Price history range">
            {["1D", "7D", "1M", "1Y", "ALL"].map((item) => (
              <button key={item} aria-pressed={range === item} disabled={busy} onClick={() => void changeRange(item)}>
                {item}
              </button>
            ))}
          </div>
          <div className="sf-row">
            {!isFullscreen ? (
              <button className="sf-button sf-primary" onClick={() => void window.openai?.requestDisplayMode?.("fullscreen")}>
                Open market
              </button>
            ) : null}
            <button className="sf-button" disabled={busy} onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
        </div>
        <PriceChart points={array(history.points)} />
        <div className="sf-grid sf-section">
          <div className="sf-stat"><div className="sf-label">Pool liquidity</div><div className="sf-value">{formatMoney(market.liquidity)}</div></div>
          <div className="sf-stat"><div className="sf-label">24h volume</div><div className="sf-value">{formatMoney(market.volume)}</div></div>
          <div className="sf-stat"><div className="sf-label">Trades</div><div className="sf-value">{formatNumber(market.totalTrades, 0)}</div></div>
          <div className="sf-stat"><div className="sf-label">Owned shares</div><div className="sf-value">{formatNumber(holding.quantity)}</div></div>
        </div>

        {isFullscreen && booleanValue(record(data.capabilities).canTrade) ? (
          <section className="sf-section">
            <div className="sf-between">
              <h3 className="sf-section-title">Trade this market</h3>
              <div className="sf-segment" aria-label="Trade side">
                <button aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Buy</button>
                <button aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell</button>
              </div>
            </div>
            <div className="sf-form-grid">
              <div className="sf-field">
                <label htmlFor="trade-amount">{side === "buy" ? "Play money to spend" : "Shares to sell"}</label>
                <input id="trade-amount" className="sf-input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" />
              </div>
              <div className="sf-stat">
                <div className="sf-label">Available</div>
                <div className="sf-value">{side === "buy" ? formatMoney(data.availableBalance) : formatNumber(holding.availableShares ?? holding.quantity)}</div>
              </div>
            </div>
            {Object.keys(quote).length ? (
              <div className="sf-grid sf-section">
                <div className="sf-stat"><div className="sf-label">Estimated output</div><div className="sf-value">{side === "buy" ? `${formatNumber(quote.sharesOut)} shares` : formatMoney(quote.sbOut)}</div></div>
                <div className="sf-stat"><div className="sf-label">Effective price</div><div className="sf-value">{formatMoney(quote.effectivePrice)}</div></div>
                <div className="sf-stat"><div className="sf-label">Price impact</div><div className="sf-value">{formatPercent(quote.slippagePercent)}</div></div>
                <div className="sf-stat"><div className="sf-label">Projected price</div><div className="sf-value">{formatMoney(quote.newPoolPrice)}</div></div>
              </div>
            ) : null}
            <div className="sf-row" style={{ marginTop: 10 }}>
              <button className="sf-button sf-primary" disabled={busy || !Object.keys(quote).length} onClick={() => void stage()}>
                Review trade
              </button>
            </div>
            {status ? <Notice tone={status.toLowerCase().includes("could not") || status.toLowerCase().includes("unavailable") ? "error" : "default"}>{status}</Notice> : null}
            {Object.keys(pending).length ? <PendingPanel pending={pending} onComplete={refresh} /> : null}
          </section>
        ) : null}
      </div>
      <footer className="sf-footer">Prices are virtual Sportfolio gameplay values. Updated {formatTime(payload.asOf)}.</footer>
    </div>
  );
}

function Portfolio({ payload, setPayload }: { payload: PresentationPayload; setPayload: (payload: PresentationPayload) => void }) {
  const summary = record(payload.data.summary);
  const holdings = array(payload.data.holdings).map(record);
  const openPlayer = async (playerId: string) => {
    const result = await callTool("render_player_market", { playerId, range: "1D" });
    const next = normalizePresentation(result);
    if (next) setPayload(next);
  };
  return (
    <div className="sf-panel">
      <header className="sf-header">
        <div><h2 className="sf-title">Your Sportfolio portfolio</h2><div className="sf-subtitle">Live virtual holdings and market exposure</div></div>
        <button className="sf-button" onClick={() => void window.openai?.requestDisplayMode?.("fullscreen")}>Fullscreen</button>
      </header>
      <div className="sf-content">
        <div className="sf-grid">
          <div className="sf-stat"><div className="sf-label">Portfolio value</div><div className="sf-value">{formatMoney(summary.totalValue)}</div></div>
          <div className="sf-stat"><div className="sf-label">Available balance</div><div className="sf-value">{formatMoney(summary.availableBalance)}</div></div>
          <div className="sf-stat"><div className="sf-label">Cost basis</div><div className="sf-value">{formatMoney(summary.costBasis)}</div></div>
          <div className="sf-stat"><div className="sf-label">Holdings</div><div className="sf-value">{formatNumber(summary.holdingCount, 0)}</div></div>
        </div>
        <div className="sf-scroll sf-section">
          <table className="sf-table">
            <thead><tr><th>Player</th><th>Shares</th><th>Price</th><th>Value</th><th /></tr></thead>
            <tbody>
              {holdings.map((holding) => {
                const player = record(holding.player);
                return (
                  <tr key={stringValue(player.playerId)}>
                    <td><strong>{stringValue(player.displayName, "Unknown player")}</strong><div className="sf-muted">{[stringValue(player.team), stringValue(player.sport)].filter(Boolean).join(" · ")}</div></td>
                    <td>{formatNumber(holding.quantity)}</td>
                    <td>{formatMoney(holding.currentPrice)}</td>
                    <td>{formatMoney(holding.positionValue)}</td>
                    <td><button className="sf-button" onClick={() => void openPlayer(stringValue(player.playerId))}>View market</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!holdings.length ? <Notice>No player holdings are currently available.</Notice> : null}
      </div>
      <footer className="sf-footer">Updated {formatTime(payload.asOf)}.</footer>
    </div>
  );
}

function MarketMovers({ payload, setPayload }: { payload: PresentationPayload; setPayload: (payload: PresentationPayload) => void }) {
  const items = array(payload.data.items).map(record);
  const category = stringValue(payload.data.category, "market movers");
  const openPlayer = async (playerId: string) => {
    const result = await callTool("render_player_market", { playerId, range: "1D" });
    const next = normalizePresentation(result);
    if (next) setPayload(next);
  };
  return (
    <div className="sf-panel">
      <header className="sf-header"><div><h2 className="sf-title">Sportfolio market movers</h2><div className="sf-subtitle">{category.replaceAll("_", " ")}</div></div></header>
      <div className="sf-content">
        <div className="sf-carousel">
          {items.map((item) => {
            const player = record(item.player);
            const change = numberValue(item.changePercent);
            return (
              <article className="sf-card" key={stringValue(player.playerId)}>
                <PlayerIdentity player={player} />
                <div className="sf-between sf-section">
                  <div><div className="sf-label">Price</div><div className="sf-value">{formatMoney(item.currentPrice)}</div></div>
                  <div className={change > 0 ? "sf-positive" : change < 0 ? "sf-negative" : "sf-muted"}>{formatPercent(change)}</div>
                </div>
                <div className="sf-muted">Volume {formatMoney(item.volume)}</div>
                <button className="sf-button sf-primary" style={{ width: "100%", marginTop: 12 }} onClick={() => void openPlayer(stringValue(player.playerId))}>View market</button>
              </article>
            );
          })}
        </div>
        {!items.length ? <Notice>No qualifying markets were found.</Notice> : null}
      </div>
      <footer className="sf-footer">Updated {formatTime(payload.asOf)}.</footer>
    </div>
  );
}

function Liquidity({ payload, setPayload }: { payload: PresentationPayload; setPayload: (payload: PresentationPayload) => void }) {
  const data = payload.data;
  const player = record(data.player);
  const pool = record(data.pool);
  const position = record(data.position);
  const [shares, setShares] = useState("");
  const [playMoney, setPlayMoney] = useState("");
  const [lpShares, setLpShares] = useState("");
  const [pending, setPending] = useState<JsonRecord>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const result = await callTool("render_liquidity_position", { playerId: stringValue(player.playerId) });
    const next = normalizePresentation(result);
    if (next) setPayload(next);
  };

  const stage = async (mode: "add" | "remove") => {
    setBusy(true);
    setStatus("");
    try {
      const args = mode === "add"
        ? { playerId: stringValue(player.playerId), shares: Number(shares), playMoney: Number(playMoney) }
        : { playerId: stringValue(player.playerId), lpShares: Number(lpShares) };
      const result = await callTool(mode === "add" ? "stage_lp_add" : "stage_lp_remove", args);
      const body = unwrapBusinessResult(result);
      setPending(body);
      setStatus(stringValue(body.summary, "Liquidity action staged."));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Liquidity action could not be staged.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sf-panel">
      <header className="sf-header"><PlayerIdentity player={player} /><div><div className="sf-label">Liquidity position</div><div className="sf-value">{formatMoney(position.positionValue)}</div></div></header>
      <div className="sf-content">
        <div className="sf-grid">
          <div className="sf-stat"><div className="sf-label">Pool price</div><div className="sf-value">{formatMoney(pool.currentPrice)}</div></div>
          <div className="sf-stat"><div className="sf-label">Pool liquidity</div><div className="sf-value">{formatMoney(pool.liquidity)}</div></div>
          <div className="sf-stat"><div className="sf-label">LP shares</div><div className="sf-value">{formatNumber(position.lpShares)}</div></div>
          <div className="sf-stat"><div className="sf-label">Ownership</div><div className="sf-value">{formatPercent(numberValue(position.ownershipPercentage) * 100)}</div></div>
          <div className="sf-stat"><div className="sf-label">Equivalent shares</div><div className="sf-value">{formatNumber(position.equivalentShares)}</div></div>
          <div className="sf-stat"><div className="sf-label">Fees earned</div><div className="sf-value">{formatMoney(position.feesEarnedToDate)}</div></div>
        </div>
        {booleanValue(record(data.capabilities).canManage) ? (
          <>
            <section className="sf-section">
              <h3 className="sf-section-title">Add balanced liquidity</h3>
              <div className="sf-form-grid">
                <div className="sf-field"><label htmlFor="lp-shares-add">Player shares</label><input id="lp-shares-add" className="sf-input" inputMode="decimal" value={shares} onChange={(event) => setShares(event.target.value)} /></div>
                <div className="sf-field"><label htmlFor="lp-money-add">Play money</label><input id="lp-money-add" className="sf-input" inputMode="decimal" value={playMoney} onChange={(event) => setPlayMoney(event.target.value)} /></div>
              </div>
              <button className="sf-button sf-primary" style={{ marginTop: 10 }} disabled={busy || Number(shares) <= 0 || Number(playMoney) <= 0} onClick={() => void stage("add")}>Review add</button>
            </section>
            <section className="sf-section">
              <h3 className="sf-section-title">Remove liquidity</h3>
              <div className="sf-field"><label htmlFor="lp-shares-remove">LP shares to remove</label><input id="lp-shares-remove" className="sf-input" inputMode="decimal" value={lpShares} onChange={(event) => setLpShares(event.target.value)} /></div>
              <button className="sf-button" style={{ marginTop: 10 }} disabled={busy || Number(lpShares) <= 0} onClick={() => void stage("remove")}>Review removal</button>
            </section>
            {status ? <Notice>{status}</Notice> : null}
            {Object.keys(pending).length ? <PendingPanel pending={pending} onComplete={refresh} /> : null}
          </>
        ) : null}
      </div>
      <footer className="sf-footer">Liquidity values are virtual gameplay values. Updated {formatTime(payload.asOf)}.</footer>
    </div>
  );
}

function TradePreview({ payload }: { payload: PresentationPayload }) {
  return (
    <div className="sf-panel">
      <header className="sf-header"><div><h2 className="sf-title">Sportfolio action review</h2><div className="sf-subtitle">Confirm only the exact staged bundle shown below</div></div></header>
      <div className="sf-content"><PendingPanel pending={payload.data} /></div>
      <footer className="sf-footer">Loaded {formatTime(payload.asOf)}.</footer>
    </div>
  );
}

function App() {
  const [payload, setPayload] = usePresentation();
  if (!payload) {
    return <><style>{CSS}</style><div className="sf-shell"><div className="sf-panel sf-loading">Loading Sportfolio…</div></div></>;
  }
  return (
    <>
      <style>{CSS}</style>
      <main className="sf-shell">
        {payload.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}
        {payload.view === "player_market" ? <PlayerMarket payload={payload} setPayload={setPayload} /> : null}
        {payload.view === "portfolio" ? <Portfolio payload={payload} setPayload={setPayload} /> : null}
        {payload.view === "market_movers" ? <MarketMovers payload={payload} setPayload={setPayload} /> : null}
        {payload.view === "liquidity" ? <Liquidity payload={payload} setPayload={setPayload} /> : null}
        {payload.view === "trade_preview" ? <TradePreview payload={payload} /> : null}
      </main>
    </>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Sportfolio widget root was not found.");
createRoot(rootElement).render(<App />);
