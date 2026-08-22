import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PlayerAvatar } from "./player-avatar";
import {
  asRecord,
  callTool,
  getHostSnapshot,
  getOpenAIHost,
  initializeMcpApp,
  notifyIntrinsicHeight,
  persistWidgetState,
  requestDisplayMode,
  sendFollowUpMessage,
  subscribeHostMessages,
  updateModelContext,
  type JsonRecord,
} from "./openai-host";

type ViewName = "player_market" | "trade_preview" | "portfolio" | "market_movers" | "liquidity";
type PresentationPayload = { view: ViewName; asOf: string; data: JsonRecord; warnings: string[] };
type WidgetState = {
  view?: ViewName;
  playerId?: string;
  range?: string;
  side?: "buy" | "sell";
  draftAmount?: string;
  portfolioSort?: string;
  selectedPlayerId?: string;
};

const VIEW_NAMES: ViewName[] = [
  "player_market",
  "trade_preview",
  "portfolio",
  "market_movers",
  "liquidity",
];

const CSS = `
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--p:light-dark(#fff,#191c23);--p2:light-dark(#f1f3f7,#222630);--t:light-dark(#151821,#f5f7fb);--m:light-dark(#626a79,#a7aebb);--b:light-dark(#dfe3ea,#303642);--a:light-dark(#3157d5,#8da8ff);--g:light-dark(#087a4b,#4bd59a);--r:light-dark(#b42318,#ff8d86)}
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;color:var(--t);background:transparent}button,input{font:inherit}.shell{padding:8px}.panel{background:var(--p);border:1px solid var(--b);border-radius:18px;overflow:hidden}.head,.between{display:flex;justify-content:space-between;gap:12px;align-items:center}.head{padding:15px;border-bottom:1px solid var(--b);align-items:flex-start}.content{padding:15px}.title{font-size:18px;font-weight:750}.sub,.muted{color:var(--m);font-size:12px}.row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:9px}.stat,.notice,.card{background:var(--p2);border:1px solid var(--b);border-radius:13px;padding:11px}.label{color:var(--m);font-size:10px;text-transform:uppercase;letter-spacing:.06em}.value{font-size:16px;font-weight:720;margin-top:3px}.btn{border:1px solid var(--b);background:var(--p2);color:var(--t);border-radius:11px;min-height:39px;padding:8px 12px;cursor:pointer;font-weight:650}.btn.primary{background:var(--a);border-color:transparent;color:light-dark(#fff,#10131a)}.btn:disabled{opacity:.5;cursor:not-allowed}.btn:focus-visible,input:focus-visible{outline:3px solid color-mix(in srgb,var(--a) 35%,transparent);outline-offset:2px}.avatar{width:46px;height:46px;border-radius:50%;object-fit:cover;background:var(--p2);border:1px solid var(--b)}.fallback{display:grid;place-items:center;color:var(--a);font-weight:800}.section{margin-top:15px}.positive{color:var(--g)}.negative{color:var(--r)}.chart{height:175px;background:var(--p2);border:1px solid var(--b);border-radius:13px;overflow:hidden}.chart svg{width:100%;height:100%}.segments{display:inline-flex;background:var(--p2);border:1px solid var(--b);border-radius:11px;padding:3px}.segments button{border:0;background:transparent;color:var(--m);border-radius:8px;padding:6px 8px;cursor:pointer}.segments button[aria-pressed=true]{background:var(--p);color:var(--t)}.field{display:grid;gap:5px}.field input{min-height:41px;border:1px solid var(--b);border-radius:11px;background:var(--p);color:var(--t);padding:8px 10px}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse}.table th,.table td{text-align:left;padding:9px 7px;border-bottom:1px solid var(--b);font-size:13px}.table th{color:var(--m);font-size:10px;text-transform:uppercase}.carousel{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(210px,78%);gap:10px;overflow-x:auto;scroll-snap-type:x mandatory}.card{scroll-snap-align:start}.footer{padding:9px 15px;border-top:1px solid var(--b);color:var(--m);font-size:10px}.loading{min-height:150px;display:grid;place-items:center;color:var(--m)}.context-actions{display:flex;gap:8px;flex-wrap:wrap}.context-actions .btn{min-height:34px;padding:6px 10px;font-size:12px}@media(max-width:520px){.shell{padding:5px}.head,.content{padding:11px}.grid{grid-template-columns:1fr 1fr}.table th:nth-child(3),.table td:nth-child(3){display:none}}
`;

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function money(value: unknown): string {
  return new Intl.NumberFormat(getOpenAIHost()?.locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(num(value));
}
function quantity(value: unknown, digits = 2): string {
  return new Intl.NumberFormat(getOpenAIHost()?.locale, { maximumFractionDigits: digits }).format(
    num(value),
  );
}
function percent(value: unknown): string {
  const n = num(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function timestamp(value: unknown): string {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString(getOpenAIHost()?.locale);
}
function normalize(value: unknown): PresentationPayload | null {
  const root = asRecord(value);
  const structured = asRecord(root.structuredContent);
  const candidate = text(structured.view)
    ? structured
    : text(root.view)
      ? root
      : asRecord(root.data);
  const view = text(candidate.view) as ViewName;
  if (!VIEW_NAMES.includes(view)) return null;
  return {
    view,
    asOf: text(candidate.asOf, new Date().toISOString()),
    data: asRecord(candidate.data),
    warnings: arr(candidate.warnings).filter((item): item is string => typeof item === "string"),
  };
}
function unwrap(value: unknown): JsonRecord {
  const root = asRecord(value);
  const structured = Object.keys(asRecord(root.structuredContent)).length
    ? asRecord(root.structuredContent)
    : root;
  return Object.prototype.hasOwnProperty.call(structured, "data")
    ? asRecord(structured.data)
    : structured;
}
function initialWidgetState(): WidgetState {
  return asRecord(getHostSnapshot().widgetState) as WidgetState;
}

function usePresentation(): {
  payload: PresentationPayload | null;
  update: (next: PresentationPayload) => void;
  widgetState: WidgetState;
  updateWidgetState: (
    patch: Partial<WidgetState>,
    modelContext?: JsonRecord,
    contextText?: string,
  ) => void;
} {
  const [payload, setPayload] = useState<PresentationPayload | null>(() =>
    normalize(getHostSnapshot().toolOutput),
  );
  const [widgetState, setLocalWidgetState] = useState<WidgetState>(initialWidgetState);

  useEffect(() => {
    const unsubscribe = subscribeHostMessages((message) => {
      if (message.method === "openai:set_globals") {
        const params = asRecord(message.params);
        const globals = asRecord(params.globals);
        const next = normalize(
          globals.toolOutput ?? params.toolOutput ?? getHostSnapshot().toolOutput,
        );
        if (next) setPayload(next);
        const nextState = asRecord(globals.widgetState ?? params.widgetState);
        if (Object.keys(nextState).length) setLocalWidgetState(nextState as WidgetState);
        return;
      }
      if (message.method === "ui/notifications/tool-result") {
        const params = asRecord(message.params);
        const next = normalize(params.result ?? params);
        if (next) setPayload(next);
      }
    });
    void initializeMcpApp();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => notifyIntrinsicHeight());
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => notifyIntrinsicHeight())
        : null;
    if (observer) observer.observe(document.body);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [payload?.view]);

  const update = useCallback((next: PresentationPayload) => {
    setPayload(next);
    setLocalWidgetState((previous) => {
      const state = { ...previous, view: next.view };
      persistWidgetState(state);
      return state;
    });
  }, []);

  const updateWidgetState = useCallback(
    (patch: Partial<WidgetState>, modelContext?: JsonRecord, contextText?: string) => {
      setLocalWidgetState((previous) => {
        const state = { ...previous, ...patch };
        persistWidgetState(state);
        return state;
      });
      if (modelContext) void updateModelContext(modelContext, contextText);
    },
    [],
  );

  return { payload, update, widgetState, updateWidgetState };
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="notice">{children}</div>;
}
function Identity({ player }: { player: JsonRecord }) {
  const name = text(player.displayName, "Unknown player");
  return (
    <div className="row">
      <PlayerAvatar player={player} fallbackClassName="avatar fallback" />
      <div>
        <div className="title">{name}</div>
        <div className="sub">
          {[text(player.team), text(player.position), text(player.sport)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
function Chart({ points }: { points: unknown[] }) {
  const values = points
    .map(asRecord)
    .map((point) => num(point.price, Number.NaN))
    .filter(Number.isFinite);
  const line = useMemo(() => {
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, Number.EPSILON);
    return values
      .map(
        (value, index) =>
          `${10 + (index / (values.length - 1)) * 620},${165 - ((value - min) / span) * 145}`,
      )
      .join(" ");
  }, [values]);
  return line ? (
    <div className="chart" role="img" aria-label={`Price history with ${values.length} points`}>
      <svg viewBox="0 0 640 180" preserveAspectRatio="none">
        <polyline fill="none" stroke="var(--a)" strokeWidth="3" points={line} />
      </svg>
    </div>
  ) : (
    <div className="chart loading">Price history is not available yet.</div>
  );
}

function PendingAction({
  pending,
  onDone,
}: {
  pending: JsonRecord;
  onDone?: () => Promise<void> | void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const transaction = asRecord(pending.transaction);
  const transactionId = text(pending.transactionId || transaction.transactionId);
  const finalize = async (tool: "confirm_pending_action" | "cancel_pending_action") => {
    if (!transactionId) {
      setMessage(
        "This staged action is missing its transaction id. Refresh and stage the action again.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = unwrap(await callTool(tool, { transactionId }));
      setMessage(
        text(
          result.summary,
          tool === "confirm_pending_action" ? "Action confirmed." : "Action canceled.",
        ),
      );
      await onDone?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action could not be finalized.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="section">
      <h3>Review pending action</h3>
      <Notice>
        <strong>
          {text(
            pending.summary,
            text(transaction.summary, "Sportfolio action ready for confirmation"),
          )}
        </strong>
      </Notice>
      {arr(pending.warnings ?? transaction.warnings)
        .filter((item): item is string => typeof item === "string")
        .map((warning) => (
          <Notice key={warning}>{warning}</Notice>
        ))}
      <div className="row section">
        <button
          className="btn primary"
          disabled={busy || !transactionId}
          onClick={() => void finalize("confirm_pending_action")}
        >
          Confirm
        </button>
        <button
          className="btn"
          disabled={busy || !transactionId}
          onClick={() => void finalize("cancel_pending_action")}
        >
          Cancel
        </button>
      </div>
      {message ? <Notice>{message}</Notice> : null}
    </section>
  );
}

type ViewProps = {
  payload: PresentationPayload;
  update: (next: PresentationPayload) => void;
  widgetState: WidgetState;
  updateWidgetState: (
    patch: Partial<WidgetState>,
    modelContext?: JsonRecord,
    contextText?: string,
  ) => void;
};

function PlayerMarket({ payload, update, widgetState, updateWidgetState }: ViewProps) {
  const data = payload.data;
  const player = asRecord(data.player);
  const market = asRecord(data.market);
  const history = asRecord(data.history);
  const holding = asRecord(data.userHolding);
  const capabilities = asRecord(data.capabilities);
  const playerId = text(player.playerId);
  const range = text(history.range, widgetState.range || "1D");
  const [side, setSide] = useState<"buy" | "sell">(widgetState.side || "buy");
  const [amount, setAmount] = useState(
    widgetState.playerId === playerId ? widgetState.draftAmount || "" : "",
  );
  const [quote, setQuote] = useState<JsonRecord>({});
  const [pending, setPending] = useState<JsonRecord>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const quoteSequence = useRef(0);
  const fullscreen = getOpenAIHost()?.displayMode === "fullscreen";
  const change = num(history.percentageChange);

  useEffect(() => {
    updateWidgetState(
      { view: "player_market", playerId, range, side, draftAmount: amount },
      { selectedPlayerId: playerId, selectedMarketRange: range },
      `Sportfolio widget selection: player ${text(player.displayName, playerId)}, market range ${range}.`,
    );
  }, [playerId, range]);

  const load = useCallback(
    async (nextRange = range) => {
      const next = normalize(
        await callTool("render_player_market", { playerId, range: nextRange }),
      );
      if (next) {
        updateWidgetState(
          { playerId, range: nextRange },
          { selectedPlayerId: playerId, selectedMarketRange: nextRange },
          `Sportfolio widget selection: player ${text(player.displayName, playerId)}, market range ${nextRange}.`,
        );
        update(next);
      }
    },
    [playerId, range, update, updateWidgetState, player.displayName],
  );

  useEffect(() => {
    const value = Number(amount);
    updateWidgetState({ playerId, side, draftAmount: amount });
    if (!(value > 0)) {
      setQuote({});
      return;
    }
    const sequence = ++quoteSequence.current;
    const timer = window.setTimeout(async () => {
      try {
        const body = unwrap(
          await callTool("get_amm_trade_quote", { playerId, type: side, amount: value }),
        );
        if (sequence === quoteSequence.current)
          setQuote(Object.keys(asRecord(body.quote)).length ? asRecord(body.quote) : body);
      } catch (error) {
        if (sequence === quoteSequence.current)
          setMessage(error instanceof Error ? error.message : "Quote unavailable.");
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [amount, playerId, side, updateWidgetState]);

  const chooseSide = (next: "buy" | "sell") => {
    setSide(next);
    updateWidgetState({ playerId, side: next, draftAmount: amount });
  };
  const stage = async () => {
    const value = Number(amount);
    if (!(value > 0)) return;
    setBusy(true);
    try {
      const result = unwrap(
        await callTool(side === "buy" ? "stage_market_buy" : "stage_market_sell", {
          playerId,
          ...(side === "buy" ? { amount: value } : { shares: value }),
        }),
      );
      setPending(result);
      setMessage(text(result.summary, "Trade staged for confirmation."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Trade could not be staged.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <header className="head">
        <Identity player={player} />
        <div style={{ textAlign: "right" }}>
          <div className="label">Market price</div>
          <div className="value">{money(market.currentPrice)}</div>
          <div className={change > 0 ? "positive" : change < 0 ? "negative" : "muted"}>
            {percent(change)}
          </div>
        </div>
      </header>
      <div className="content">
        {text(market.status) !== "active" ? (
          <Notice>{text(market.statusMessage, "This market is not active yet.")}</Notice>
        ) : null}
        <div className="between" style={{ marginBottom: 10 }}>
          <div className="segments">
            {["1D", "7D", "1M", "1Y", "ALL"].map((item) => (
              <button
                key={item}
                aria-pressed={range === item}
                disabled={busy}
                onClick={() => void load(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="row">
            {!fullscreen ? (
              <button className="btn primary" onClick={() => void requestDisplayMode("fullscreen")}>
                Open market
              </button>
            ) : null}
            <button className="btn" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
        <Chart points={arr(history.points)} />
        <div className="grid section">
          <Stat label="Pool liquidity" value={money(market.liquidity)} />
          <Stat label="Volume" value={money(market.volume)} />
          <Stat label="Trades" value={quantity(market.totalTrades, 0)} />
          <Stat label="Owned shares" value={quantity(holding.quantity)} />
        </div>
        <div className="context-actions section">
          <button
            className="btn"
            onClick={() =>
              void sendFollowUpMessage(
                `Analyze ${text(player.displayName, "this player")}'s Sportfolio market and recent performance.`,
              )
            }
          >
            Analyze this market
          </button>
        </div>
        {fullscreen && capabilities.canTrade === true ? (
          <section className="section">
            <div className="between">
              <h3>Trade this market</h3>
              <div className="segments">
                <button aria-pressed={side === "buy"} onClick={() => chooseSide("buy")}>
                  Buy
                </button>
                <button aria-pressed={side === "sell"} onClick={() => chooseSide("sell")}>
                  Sell
                </button>
              </div>
            </div>
            <div className="grid">
              <label className="field">
                <span className="muted">
                  {side === "buy" ? "Play money to spend" : "Shares to sell"}
                </span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <Stat
                label="Available"
                value={
                  side === "buy"
                    ? money(data.availableBalance)
                    : quantity(holding.availableShares ?? holding.quantity)
                }
              />
            </div>
            {Object.keys(quote).length ? (
              <div className="grid section">
                <Stat
                  label="Estimated output"
                  value={
                    side === "buy"
                      ? `${quantity(quote.sharesOut, 4)} shares`
                      : money(quote.sellerReceives ?? quote.sbOut)
                  }
                />
                <Stat label="Effective price" value={money(quote.effectivePrice)} />
                <Stat label="Price impact" value={percent(quote.slippagePercent)} />
                <Stat label="Projected price" value={money(quote.newPoolPrice)} />
              </div>
            ) : null}
            <button
              className="btn primary section"
              disabled={busy || !Object.keys(quote).length}
              onClick={() => void stage()}
            >
              Review trade
            </button>
            {message ? <Notice>{message}</Notice> : null}
            {Object.keys(pending).length ? (
              <PendingAction pending={pending} onDone={() => load()} />
            ) : null}
          </section>
        ) : null}
      </div>
      <footer className="footer">
        Virtual Sportfolio gameplay prices. Updated {timestamp(payload.asOf)}.
      </footer>
    </div>
  );
}

function Portfolio({ payload, update, updateWidgetState }: ViewProps) {
  const summary = asRecord(payload.data.summary);
  const holdings = arr(payload.data.holdings).map(asRecord);
  const open = async (playerId: string, playerName: string) => {
    updateWidgetState(
      { selectedPlayerId: playerId },
      { selectedPlayerId: playerId },
      `Sportfolio widget selection: ${playerName || playerId}.`,
    );
    const next = normalize(await callTool("render_player_market", { playerId, range: "1D" }));
    if (next) update(next);
  };
  return (
    <div className="panel">
      <header className="head">
        <div>
          <div className="title">Your Sportfolio portfolio</div>
          <div className="sub">Live virtual holdings and market exposure</div>
        </div>
        <button className="btn" onClick={() => void requestDisplayMode("fullscreen")}>
          Fullscreen
        </button>
      </header>
      <div className="content">
        <div className="grid">
          <Stat label="Portfolio value" value={money(summary.totalValue)} />
          <Stat label="Available balance" value={money(summary.availableBalance)} />
          <Stat label="Cost basis" value={money(summary.costBasis)} />
          <Stat label="Holdings" value={quantity(summary.holdingCount, 0)} />
        </div>
        <div className="table-wrap section">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Shares</th>
                <th>Price</th>
                <th>Value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => {
                const player = asRecord(holding.player);
                const playerId = text(player.playerId);
                const name = text(player.displayName);
                return (
                  <tr key={playerId}>
                    <td>
                      <strong>{name}</strong>
                      <div className="muted">
                        {[text(player.team), text(player.sport)].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td>{quantity(holding.quantity)}</td>
                    <td>{money(holding.currentPrice)}</td>
                    <td>{money(holding.positionValue)}</td>
                    <td>
                      <button className="btn" onClick={() => void open(playerId, name)}>
                        View market
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {holdings.length ? null : <Notice>No player holdings are currently available.</Notice>}
      </div>
      <footer className="footer">Updated {timestamp(payload.asOf)}.</footer>
    </div>
  );
}

function Movers({ payload, update, updateWidgetState }: ViewProps) {
  const items = arr(payload.data.items).map(asRecord);
  const open = async (playerId: string, playerName: string) => {
    updateWidgetState(
      { selectedPlayerId: playerId },
      { selectedPlayerId: playerId },
      `Sportfolio widget selection: ${playerName || playerId}.`,
    );
    const next = normalize(await callTool("render_player_market", { playerId, range: "1D" }));
    if (next) update(next);
  };
  return (
    <div className="panel">
      <header className="head">
        <div>
          <div className="title">Sportfolio market movers</div>
          <div className="sub">{text(payload.data.category, "gainers").replaceAll("_", " ")}</div>
        </div>
      </header>
      <div className="content">
        <div className="carousel">
          {items.map((item) => {
            const player = asRecord(item.player);
            const playerId = text(player.playerId);
            const name = text(player.displayName);
            const change = num(item.changePercent);
            return (
              <article className="card" key={playerId}>
                <Identity player={player} />
                <div className="between section">
                  <Stat label="Price" value={money(item.currentPrice)} />
                  <strong className={change > 0 ? "positive" : change < 0 ? "negative" : "muted"}>
                    {percent(change)}
                  </strong>
                </div>
                <div className="muted">Volume {money(item.volume)}</div>
                <button
                  className="btn primary section"
                  style={{ width: "100%" }}
                  onClick={() => void open(playerId, name)}
                >
                  View market
                </button>
              </article>
            );
          })}
        </div>
        {items.length ? null : <Notice>No qualifying markets were found.</Notice>}
      </div>
      <footer className="footer">Updated {timestamp(payload.asOf)}.</footer>
    </div>
  );
}

function Liquidity({ payload, update }: ViewProps) {
  const data = payload.data;
  const player = asRecord(data.player);
  const pool = asRecord(data.pool);
  const position = asRecord(data.position);
  const [shares, setShares] = useState("");
  const [playMoney, setPlayMoney] = useState("");
  const [lpShares, setLpShares] = useState("");
  const [pending, setPending] = useState<JsonRecord>({});
  const [message, setMessage] = useState("");
  const refresh = async () => {
    const next = normalize(
      await callTool("render_liquidity_position", { playerId: text(player.playerId) }),
    );
    if (next) update(next);
  };
  const stage = async (mode: "add" | "remove") => {
    try {
      const result = unwrap(
        await callTool(
          mode === "add" ? "stage_lp_add" : "stage_lp_remove",
          mode === "add"
            ? {
                playerId: text(player.playerId),
                shares: Number(shares),
                playMoney: Number(playMoney),
              }
            : { playerId: text(player.playerId), lpShares: Number(lpShares) },
        ),
      );
      setPending(result);
      setMessage(text(result.summary, "Liquidity action staged."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Liquidity action could not be staged.");
    }
  };
  return (
    <div className="panel">
      <header className="head">
        <Identity player={player} />
        <Stat label="Liquidity position" value={money(position.positionValue)} />
      </header>
      <div className="content">
        <div className="grid">
          <Stat label="Pool price" value={money(pool.currentPrice)} />
          <Stat label="Pool liquidity" value={money(pool.liquidity)} />
          <Stat label="LP shares" value={quantity(position.lpShares)} />
          <Stat label="Ownership" value={percent(num(position.ownershipPercentage) * 100)} />
          <Stat label="Equivalent shares" value={quantity(position.equivalentShares)} />
          <Stat label="Fees earned" value={money(position.feesEarnedToDate)} />
        </div>
        {asRecord(data.capabilities).canManage === true ? (
          <>
            <section className="section">
              <h3>Add balanced liquidity</h3>
              <div className="grid">
                <label className="field">
                  <span className="muted">Player shares</span>
                  <input
                    inputMode="decimal"
                    value={shares}
                    onChange={(event) => setShares(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="muted">Play money</span>
                  <input
                    inputMode="decimal"
                    value={playMoney}
                    onChange={(event) => setPlayMoney(event.target.value)}
                  />
                </label>
              </div>
              <button
                className="btn primary section"
                disabled={!(Number(shares) > 0 && Number(playMoney) > 0)}
                onClick={() => void stage("add")}
              >
                Review add
              </button>
            </section>
            <section className="section">
              <h3>Remove liquidity</h3>
              <label className="field">
                <span className="muted">LP shares to remove</span>
                <input
                  inputMode="decimal"
                  value={lpShares}
                  onChange={(event) => setLpShares(event.target.value)}
                />
              </label>
              <button
                className="btn section"
                disabled={!(Number(lpShares) > 0)}
                onClick={() => void stage("remove")}
              >
                Review removal
              </button>
            </section>
            {message ? <Notice>{message}</Notice> : null}
            {Object.keys(pending).length ? (
              <PendingAction pending={pending} onDone={refresh} />
            ) : null}
          </>
        ) : null}
      </div>
      <footer className="footer">
        Virtual gameplay liquidity. Updated {timestamp(payload.asOf)}.
      </footer>
    </div>
  );
}

function App() {
  const presentation = usePresentation();
  const { payload } = presentation;
  return (
    <>
      <style>{CSS}</style>
      <main className="shell">
        {payload ? (
          <>
            {payload.warnings.map((warning) => (
              <Notice key={warning}>{warning}</Notice>
            ))}
            {payload.view === "player_market" ? (
              <PlayerMarket {...presentation} payload={payload} />
            ) : null}
            {payload.view === "portfolio" ? (
              <Portfolio {...presentation} payload={payload} />
            ) : null}
            {payload.view === "market_movers" ? (
              <Movers {...presentation} payload={payload} />
            ) : null}
            {payload.view === "liquidity" ? (
              <Liquidity {...presentation} payload={payload} />
            ) : null}
            {payload.view === "trade_preview" ? (
              <div className="panel">
                <header className="head">
                  <div>
                    <div className="title">Sportfolio action review</div>
                    <div className="sub">Confirm only the exact staged transaction</div>
                  </div>
                </header>
                <div className="content">
                  <PendingAction pending={payload.data} />
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="panel loading">Loading Sportfolio…</div>
        )}
      </main>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Sportfolio widget root was not found.");
createRoot(root).render(<App />);
