import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ACTION_REVIEW_CSS, ActionReviewPanel } from "./action-review-panel";
import { PlayerAvatar } from "./player-avatar";
import { formatSportfolioBucks } from "./virtual-currency";
import {
  asRecord,
  callTool,
  getHostSnapshot,
  getOpenAIHost,
  initializeMcpApp,
  notifyIntrinsicHeight,
  persistWidgetState,
  requestDisplayMode,
  requestModal,
  sendFollowUpMessage,
  subscribeHostMessages,
  updateModelContext,
  type JsonRecord,
} from "./openai-host";

type MarketPortfolioView = "player_market" | "portfolio";
type Payload = { view: MarketPortfolioView; asOf: string; data: JsonRecord; warnings: string[] };
type LocalState = {
  view?: MarketPortfolioView;
  playerId?: string;
  marketRange?: string;
  portfolioRange?: string;
  portfolioSort?: string;
  side?: "buy" | "sell";
  draftAmount?: string;
};

const ACTION_REVIEW_URI = "ui://sportfolio/action-review/v1.html";
const RANGES = ["1D", "7D", "1M", "1Y", "ALL"] as const;

const CSS = `
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--p:light-dark(#fff,#191c23);--p2:light-dark(#f3f5f8,#222630);--p3:light-dark(#e9edf4,#2a303a);--t:light-dark(#151821,#f5f7fb);--m:light-dark(#626a79,#a7aebb);--b:light-dark(#dfe3ea,#303642);--a:light-dark(#3157d5,#8da8ff);--g:light-dark(#087a4b,#4bd59a);--r:light-dark(#b42318,#ff8d86)}
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;color:var(--t);background:transparent}button,input,select{font:inherit}.shell{padding:8px}.panel{background:var(--p);border:1px solid var(--b);border-radius:18px;overflow:hidden}.head,.between,.row{display:flex;align-items:center;gap:10px}.head,.between{justify-content:space-between}.head{padding:15px;border-bottom:1px solid var(--b);align-items:flex-start}.content{padding:15px}.title{font-size:18px;font-weight:780}.sub,.muted{color:var(--m);font-size:12px}.label{color:var(--m);font-size:10px;text-transform:uppercase;letter-spacing:.06em}.value{font-size:17px;font-weight:750;margin-top:3px}.btn{border:1px solid var(--b);background:var(--p2);color:var(--t);border-radius:11px;min-height:38px;padding:8px 12px;cursor:pointer;font-weight:650}.btn.primary{background:var(--a);border-color:transparent;color:light-dark(#fff,#10131a)}.btn:disabled{opacity:.5;cursor:not-allowed}.btn:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid color-mix(in srgb,var(--a) 35%,transparent);outline-offset:2px}.avatar{width:50px;height:50px;border-radius:50%;object-fit:cover;background:var(--p2);border:1px solid var(--b)}.avatar-fallback{display:grid;place-items:center;font-weight:800;color:var(--a)}.positive{color:var(--g)}.negative{color:var(--r)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:9px}.stat,.card,.notice{background:var(--p2);border:1px solid var(--b);border-radius:13px;padding:11px}.section{margin-top:15px}.chart{height:190px;background:var(--p2);border:1px solid var(--b);border-radius:14px;overflow:hidden;position:relative}.chart svg{width:100%;height:100%}.chart-empty{display:grid;place-items:center;color:var(--m)}.segments{display:inline-flex;background:var(--p2);border:1px solid var(--b);border-radius:11px;padding:3px;overflow:auto;max-width:100%}.segments button{border:0;background:transparent;color:var(--m);border-radius:8px;padding:6px 9px;cursor:pointer;white-space:nowrap}.segments button[aria-pressed=true]{background:var(--p);color:var(--t)}.field{display:grid;gap:5px}.field input,.field select{min-height:41px;border:1px solid var(--b);border-radius:11px;background:var(--p);color:var(--t);padding:8px 10px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}.metric{padding:9px;border-radius:11px;background:var(--p2);border:1px solid var(--b)}.games{display:grid;gap:7px}.game{display:grid;grid-template-columns:minmax(95px,1.2fr) 1fr auto;gap:9px;align-items:center;padding:9px;border-radius:11px;background:var(--p2);border:1px solid var(--b);font-size:12px}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse}.table th,.table td{text-align:left;padding:9px 7px;border-bottom:1px solid var(--b);font-size:12px;white-space:nowrap}.table th{color:var(--m);font-size:10px;text-transform:uppercase;letter-spacing:.04em}.table button{white-space:nowrap}.allocation{display:grid;gap:8px}.allocation-row{display:grid;grid-template-columns:minmax(70px,120px) 1fr auto;gap:9px;align-items:center;font-size:12px}.allocation-track{height:9px;border-radius:999px;background:var(--p3);overflow:hidden}.allocation-fill{height:100%;background:var(--a);border-radius:999px}.summary-hero{display:grid;grid-template-columns:1.3fr 1fr;gap:10px}.hero-value{font-size:28px;font-weight:850;letter-spacing:-.03em}.trade-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.footer{padding:9px 15px;border-top:1px solid var(--b);color:var(--m);font-size:10px}.loading{min-height:150px;display:grid;place-items:center;color:var(--m)}${ACTION_REVIEW_CSS}@media(max-width:620px){.shell{padding:5px}.head,.content{padding:11px}.summary-hero,.trade-grid{grid-template-columns:1fr}.table th:nth-child(4),.table td:nth-child(4){display:none}.game{grid-template-columns:1fr auto}.game>:nth-child(2){display:none}.hero-value{font-size:24px}}
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
  return formatSportfolioBucks(num(value), getOpenAIHost()?.locale);
}
function marketMoney(value: unknown, marketStatus: unknown): string {
  return marketStatus === "unpriced" || value == null ? "Unpriced" : money(value);
}
function quantity(value: unknown, digits = 2): string {
  return new Intl.NumberFormat(getOpenAIHost()?.locale, { maximumFractionDigits: digits }).format(
    num(value),
  );
}
function pct(value: unknown): string {
  const n = num(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function when(value: unknown): string {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(getOpenAIHost()?.locale, { month: "short", day: "numeric" });
}
function normalize(value: unknown): Payload | null {
  const root = asRecord(value);
  const structured = asRecord(root.structuredContent);
  const candidate = text(structured.view)
    ? structured
    : text(root.view)
      ? root
      : asRecord(root.data);
  const view = text(candidate.view) as MarketPortfolioView;
  if (view !== "player_market" && view !== "portfolio") return null;
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

function usePresentation() {
  const [payload, setPayload] = useState<Payload | null>(() =>
    normalize(getHostSnapshot().toolOutput),
  );
  const [state, setState] = useState<LocalState>(
    () => asRecord(getHostSnapshot().widgetState) as LocalState,
  );
  const [displayMode, setDisplayMode] = useState(text(getHostSnapshot().displayMode, "inline"));

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
        if (Object.keys(nextState).length) setState(nextState as LocalState);
        setDisplayMode(
          text(
            globals.displayMode ?? params.displayMode ?? getHostSnapshot().displayMode,
            "inline",
          ),
        );
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
    observer?.observe(document.body);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [payload?.view, displayMode]);

  const update = useCallback((next: Payload) => {
    setPayload(next);
    setState((previous) => {
      const merged = { ...previous, view: next.view };
      persistWidgetState(merged);
      return merged;
    });
  }, []);

  const patchState = useCallback(
    (patch: Partial<LocalState>, modelContext?: JsonRecord, summary?: string) => {
      setState((previous) => {
        const merged = { ...previous, ...patch };
        persistWidgetState(merged);
        return merged;
      });
      if (modelContext) void updateModelContext(modelContext, summary);
    },
    [],
  );

  return { payload, update, state, patchState, displayMode };
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="notice">{children}</div>;
}
function Stat({
  label,
  value,
  className = "",
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value ${className}`}>{value}</div>
    </div>
  );
}
function Identity({ player }: { player: JsonRecord }) {
  const name = text(player.displayName, "Unknown player");
  return (
    <div className="row">
      <PlayerAvatar player={player} />
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
function LineChart({ points, valueKey }: { points: unknown[]; valueKey: string }) {
  const values = points
    .map(asRecord)
    .map((point) => num(point[valueKey], Number.NaN))
    .filter(Number.isFinite);
  const line = useMemo(() => {
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, Number.EPSILON);
    return values
      .map(
        (value, index) =>
          `${10 + (index / (values.length - 1)) * 620},${175 - ((value - min) / span) * 155}`,
      )
      .join(" ");
  }, [values]);
  if (!line) return <div className="chart chart-empty">History is not available yet.</div>;
  return (
    <div className="chart" role="img" aria-label={`${values.length}-point performance history`}>
      <svg viewBox="0 0 640 190" preserveAspectRatio="none">
        <polyline fill="none" stroke="var(--a)" strokeWidth="3" points={line} />
      </svg>
    </div>
  );
}

function friendlyKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
}
function MetricGrid({ data, max = 8 }: { data: JsonRecord; max?: number }) {
  const entries = Object.entries(data)
    .filter(([, value]) => typeof value === "number" || typeof value === "string")
    .slice(0, max);
  if (!entries.length) return null;
  return (
    <div className="metrics">
      {entries.map(([key, value]) => (
        <div className="metric" key={key}>
          <div className="label">{friendlyKey(key)}</div>
          <div className="value">{typeof value === "number" ? quantity(value) : String(value)}</div>
        </div>
      ))}
    </div>
  );
}

function PlayerMarket(props: ReturnType<typeof usePresentation> & { payload: Payload }) {
  const { payload, update, state, patchState, displayMode } = props;
  const data = payload.data;
  const player = asRecord(data.player);
  const market = asRecord(data.market);
  const history = asRecord(data.history);
  const holding = asRecord(data.userHolding);
  const capabilities = asRecord(data.capabilities);
  const financial = asRecord(data.financialMetrics);
  const stats = asRecord(data.stats);
  const recentGames = arr(data.recentGames).map(asRecord);
  const playerId = text(player.playerId);
  const range = text(history.range, state.marketRange || "1D");
  const [side, setSide] = useState<"buy" | "sell">(state.side || "buy");
  const [amount, setAmount] = useState(state.playerId === playerId ? state.draftAmount || "" : "");
  const [quote, setQuote] = useState<JsonRecord>({});
  const [inlineReview, setInlineReview] = useState<JsonRecord>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const quoteSequence = useRef(0);
  const fullscreen = displayMode === "fullscreen";
  const change = num(history.percentageChange);

  useEffect(() => {
    patchState(
      { view: "player_market", playerId, marketRange: range },
      { selectedPlayerId: playerId, selectedMarketRange: range },
      `Sportfolio market selection: ${text(player.displayName, playerId)}, range ${range}.`,
    );
  }, [playerId, range]);

  const load = useCallback(
    async (nextRange = range) => {
      const next = normalize(
        await callTool("render_player_market", { playerId, range: nextRange }),
      );
      if (next) {
        patchState(
          { playerId, marketRange: nextRange },
          { selectedPlayerId: playerId, selectedMarketRange: nextRange },
        );
        update(next);
      }
    },
    [playerId, range, patchState, update],
  );

  useEffect(() => {
    const value = Number(amount);
    patchState({ playerId, side, draftAmount: amount });
    if (!(value > 0)) {
      setQuote({});
      return;
    }
    const sequence = ++quoteSequence.current;
    const timer = window.setTimeout(async () => {
      try {
        const result = unwrap(
          await callTool("get_amm_trade_quote", { playerId, type: side, amount: value }),
        );
        if (sequence === quoteSequence.current)
          setQuote(Object.keys(asRecord(result.quote)).length ? asRecord(result.quote) : result);
      } catch (error) {
        if (sequence === quoteSequence.current)
          setMessage(error instanceof Error ? error.message : "Quote unavailable.");
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [amount, playerId, side]);

  const stageTrade = async () => {
    const value = Number(amount);
    if (!(value > 0)) return;
    setBusy(true);
    setMessage("");
    try {
      const staged = unwrap(
        await callTool(side === "buy" ? "stage_market_buy" : "stage_market_sell", {
          playerId,
          ...(side === "buy" ? { amount: value } : { shares: value }),
        }),
      );
      const transactionId = text(
        staged.transactionId || asRecord(staged.transaction).transactionId,
      );
      if (!transactionId) throw new Error("The staged trade did not return a transaction id.");
      try {
        await requestModal({ transactionId }, ACTION_REVIEW_URI);
        await load();
      } catch {
        const review = unwrap(await callTool("render_action_review", { transactionId }));
        setInlineReview(review);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The trade could not be staged.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <header className="head">
        <Identity player={player} />
        <div style={{ textAlign: "right" }}>
          <div className="label">Virtual price</div>
          <div className="value">{marketMoney(market.currentPrice, text(market.status))}</div>
          <div className={change > 0 ? "positive" : change < 0 ? "negative" : "muted"}>
            {pct(change)}
          </div>
        </div>
      </header>
      <div className="content">
        {text(market.status) !== "priced" ? (
          <Notice>{text(market.statusMessage, "This market is not active yet.")}</Notice>
        ) : null}
        <div className="between">
          <div className="segments">
            {RANGES.map((item) => (
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
            <button
              className="btn"
              onClick={() =>
                void sendFollowUpMessage(
                  `Analyze ${text(player.displayName, "this player")}'s Sportfolio market, recent performance, and virtual price movement.`,
                )
              }
            >
              Analyze
            </button>
          </div>
        </div>
        <div className="section">
          <LineChart points={arr(history.points)} valueKey="price" />
        </div>
        <div className="grid section">
          <Stat label="Owned shares" value={quantity(holding.quantity)} />
          <Stat
            label="Available shares"
            value={quantity(holding.availableShares ?? holding.quantity)}
          />
          <Stat label="Pool liquidity" value={money(market.liquidity)} />
          <Stat label="Market volume" value={money(market.volume)} />
          <Stat label="Trades" value={quantity(market.totalTrades, 0)} />
          <Stat label="Available balance" value={money(data.availableBalance)} />
        </div>
        {fullscreen ? (
          <>
            {Object.keys(financial).length ? (
              <section className="section">
                <div className="between">
                  <h3>Virtual market metrics</h3>
                  <span className="muted">Server-calculated</span>
                </div>
                <MetricGrid data={financial} />
              </section>
            ) : null}
            {Object.keys(stats).length ? (
              <section className="section">
                <h3>Season performance</h3>
                <MetricGrid data={stats} max={10} />
              </section>
            ) : null}
            {recentGames.length ? (
              <section className="section">
                <h3>Recent games</h3>
                <div className="games">
                  {recentGames.slice(0, 6).map((game, index) => (
                    <div className="game" key={`${text(game.gameId)}:${index}`}>
                      <strong>
                        {when(game.date || game.gameDate) || text(game.opponent, "Recent game")}
                      </strong>
                      <span className="muted">
                        {[text(game.opponent), text(game.result)].filter(Boolean).join(" · ")}
                      </span>
                      <span>
                        {game.fantasyPoints != null
                          ? `${quantity(game.fantasyPoints)} FP`
                          : text(game.summary, "")}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {capabilities.canTrade === true ? (
              <section className="section">
                <div className="between">
                  <h3>Trade virtual shares</h3>
                  <div className="segments">
                    <button aria-pressed={side === "buy"} onClick={() => setSide("buy")}>
                      Buy
                    </button>
                    <button aria-pressed={side === "sell"} onClick={() => setSide("sell")}>
                      Sell
                    </button>
                  </div>
                </div>
                <div className="trade-grid">
                  <label className="field">
                    <span className="muted">
                      {side === "buy" ? "SB to spend" : "Shares to sell"}
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
                    <Stat label="Price impact" value={pct(quote.slippagePercent)} />
                    <Stat label="Projected price" value={money(quote.newPoolPrice)} />
                  </div>
                ) : null}
                <button
                  className="btn primary section"
                  disabled={busy || !Object.keys(quote).length}
                  onClick={() => void stageTrade()}
                >
                  Review trade
                </button>
                {message ? <Notice>{message}</Notice> : null}
                {Object.keys(inlineReview).length ? (
                  <div className="section">
                    <ActionReviewPanel review={inlineReview} onFinalized={() => load()} />
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
      <footer className="footer">
        Virtual Sportfolio gameplay values. Updated{" "}
        {new Date(payload.asOf).toLocaleTimeString(getOpenAIHost()?.locale)}.
      </footer>
    </div>
  );
}

function Portfolio(props: ReturnType<typeof usePresentation> & { payload: Payload }) {
  const { payload, update, state, patchState, displayMode } = props;
  const data = payload.data;
  const summary = asRecord(data.summary);
  const allocations = arr(data.allocations).map(asRecord);
  const holdings = arr(data.holdings).map(asRecord);
  const fullscreen = displayMode === "fullscreen";
  const [range, setRange] = useState(state.portfolioRange || "1M");
  const [history, setHistory] = useState<unknown[]>([]);
  const [sort, setSort] = useState(state.portfolioSort || "value");
  const [historyMessage, setHistoryMessage] = useState("");
  const unrealized = num(summary.unrealizedChange);
  const unrealizedPct = num(summary.unrealizedChangePercent);

  const loadHistory = useCallback(
    async (nextRange: string) => {
      setHistoryMessage("");
      try {
        const result = unwrap(await callTool("get_portfolio_history", { timeRange: nextRange }));
        setHistory(arr(result.history));
        setRange(nextRange);
        patchState(
          { portfolioRange: nextRange },
          { selectedPortfolioRange: nextRange },
          `Sportfolio portfolio performance range selected: ${nextRange}.`,
        );
      } catch (error) {
        setHistoryMessage(
          error instanceof Error ? error.message : "Portfolio history is unavailable.",
        );
      }
    },
    [patchState],
  );

  useEffect(() => {
    if (fullscreen && !history.length) void loadHistory(range);
  }, [fullscreen]);

  const ordered = useMemo(() => {
    return [...holdings].sort((a, b) => {
      if (sort === "gain") return num(b.unrealizedChange) - num(a.unrealizedChange);
      if (sort === "loss") return num(a.unrealizedChange) - num(b.unrealizedChange);
      if (sort === "quantity") return num(b.quantity) - num(a.quantity);
      if (sort === "name")
        return text(asRecord(a.player).displayName).localeCompare(
          text(asRecord(b.player).displayName),
        );
      return num(b.positionValue) - num(a.positionValue);
    });
  }, [holdings, sort]);

  const openMarket = async (holding: JsonRecord) => {
    const player = asRecord(holding.player);
    const playerId = text(player.playerId);
    if (!playerId) return;
    patchState(
      { playerId },
      { selectedPlayerId: playerId },
      `Sportfolio holding selected: ${text(player.displayName, playerId)}.`,
    );
    const next = normalize(await callTool("render_player_market", { playerId, range: "1D" }));
    if (next) update(next);
  };

  return (
    <div className="panel">
      <header className="head">
        <div>
          <div className="title">Your Sportfolio portfolio</div>
          <div className="sub">Virtual holdings, exposure, and performance</div>
        </div>
        <div className="row">
          {!fullscreen ? (
            <button className="btn primary" onClick={() => void requestDisplayMode("fullscreen")}>
              Open portfolio
            </button>
          ) : null}
          <button
            className="btn"
            onClick={() =>
              void sendFollowUpMessage(
                "Analyze my Sportfolio portfolio, including concentration, strongest and weakest virtual holdings, and any live-game context available.",
              )
            }
          >
            Analyze
          </button>
        </div>
      </header>
      <div className="content">
        <div className="summary-hero">
          <div className="card">
            <div className="label">Virtual portfolio value</div>
            <div className="hero-value">{money(summary.totalValue)}</div>
            <div className={unrealized > 0 ? "positive" : unrealized < 0 ? "negative" : "muted"}>
              {unrealized >= 0 ? "+" : ""}
              {money(unrealized)} · {pct(unrealizedPct)} unrealized
            </div>
          </div>
          <div className="grid">
            <Stat label="Available balance" value={money(summary.availableBalance)} />
            <Stat label="LP value" value={money(summary.lpMarketValue)} />
            <Stat label="Singles" value={quantity(summary.totalSingles)} />
          </div>
        </div>
        {fullscreen ? (
          <>
            <section className="section">
              <div className="between">
                <h3>Performance</h3>
                <div className="segments">
                  {RANGES.map((item) => (
                    <button
                      key={item}
                      aria-pressed={range === item}
                      onClick={() => void loadHistory(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <LineChart points={history} valueKey="netWorth" />
              {historyMessage ? <Notice>{historyMessage}</Notice> : null}
            </section>
            {allocations.length ? (
              <section className="section">
                <h3>Allocation by sport</h3>
                <div className="allocation">
                  {allocations.map((allocation) => {
                    const percentage = Math.max(0, Math.min(100, num(allocation.percentage)));
                    return (
                      <div
                        className="allocation-row"
                        key={text(allocation.key, text(allocation.label))}
                      >
                        <strong>{text(allocation.label, text(allocation.key, "Other"))}</strong>
                        <div className="allocation-track">
                          <div className="allocation-fill" style={{ width: `${percentage}%` }} />
                        </div>
                        <span>{percentage.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
        <section className="section">
          <div className="between">
            <h3>Holdings</h3>
            {fullscreen ? (
              <label className="field">
                <span className="muted">Sort</span>
                <select
                  value={sort}
                  onChange={(event) => {
                    setSort(event.target.value);
                    patchState({ portfolioSort: event.target.value });
                  }}
                >
                  <option value="value">Value</option>
                  <option value="gain">Best gain</option>
                  <option value="loss">Largest loss</option>
                  <option value="quantity">Quantity</option>
                  <option value="name">Name</option>
                </select>
              </label>
            ) : null}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Singles</th>
                  <th>Gameplay Power</th>
                  <th>Value</th>
                  <th>Avg cost</th>
                  <th>Unrealized</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ordered.slice(0, fullscreen ? 50 : 6).map((holding) => {
                  const player = asRecord(holding.player);
                  const change = num(holding.unrealizedChange);
                  return (
                    <tr key={text(player.playerId)}>
                      <td>
                        <strong>{text(player.displayName)}</strong>
                        <div className="muted">
                          {[text(player.team), text(player.sport)].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td>{quantity(holding.singles ?? holding.quantity)}</td>
                      <td>{marketMoney(holding.positionValue, holding.marketStatus)}</td>
                      <td>{money(holding.averageCostBasis)}</td>
                      <td className={change > 0 ? "positive" : change < 0 ? "negative" : ""}>
                        {holding.unrealizedChange == null ? (
                          "—"
                        ) : (
                          <>
                            {change >= 0 ? "+" : ""}
                            {money(change)}
                            <div className="muted">{pct(holding.unrealizedChangePercent)}</div>
                          </>
                        )}
                      </td>
                      <td>
                        <button className="btn" onClick={() => void openMarket(holding)}>
                          Market
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!holdings.length ? <Notice>No virtual holdings are currently available.</Notice> : null}
        </section>
      </div>
      <footer className="footer">
        Virtual Sportfolio gameplay values. Updated{" "}
        {new Date(payload.asOf).toLocaleTimeString(getOpenAIHost()?.locale)}.
      </footer>
    </div>
  );
}

function App() {
  const presentation = usePresentation();
  const payload = presentation.payload;
  return (
    <>
      <style>{CSS}</style>
      <main className="shell">
        {payload?.warnings.map((warning) => (
          <Notice key={warning}>{warning}</Notice>
        ))}
        {payload ? (
          payload.view === "player_market" ? (
            <PlayerMarket {...presentation} payload={payload} />
          ) : (
            <Portfolio {...presentation} payload={payload} />
          )
        ) : (
          <div className="panel loading">Loading Sportfolio…</div>
        )}
      </main>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Sportfolio market/portfolio widget root was not found.");
createRoot(root).render(<App />);
