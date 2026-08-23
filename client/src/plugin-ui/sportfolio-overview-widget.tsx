import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
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
  subscribeHostMessages,
  updateModelContext,
  type JsonRecord,
} from "./openai-host";

type OverviewView = "dashboard" | "collections" | "rankings";
type Payload = { view: OverviewView; asOf: string; data: JsonRecord; warnings: string[] };
type LocalState = { view?: OverviewView; collectionKey?: string; rankingCategory?: string };

const CSS = `
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--p:light-dark(#fff,#191c23);--p2:light-dark(#f2f4f8,#222630);--t:light-dark(#151821,#f5f7fb);--m:light-dark(#626a79,#a7aebb);--b:light-dark(#dfe3ea,#303642);--a:light-dark(#3157d5,#8da8ff);--g:light-dark(#087a4b,#4bd59a);--r:light-dark(#b42318,#ff8d86)}
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;color:var(--t);background:transparent}button{font:inherit}.shell{padding:8px}.panel{background:var(--p);border:1px solid var(--b);border-radius:18px;overflow:hidden}.head,.between,.row{display:flex;gap:10px;align-items:center}.head,.between{justify-content:space-between}.head{padding:15px;border-bottom:1px solid var(--b);align-items:flex-start}.content{padding:15px}.title{font-size:18px;font-weight:780}.sub,.muted{font-size:12px;color:var(--m)}.label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--m)}.value{font-size:17px;font-weight:740;margin-top:3px}.btn{border:1px solid var(--b);background:var(--p2);color:var(--t);border-radius:11px;min-height:38px;padding:8px 12px;cursor:pointer;font-weight:650}.btn.primary{background:var(--a);border-color:transparent;color:light-dark(#fff,#10131a)}.btn.active{border-color:var(--a);color:var(--a)}.btn:disabled{opacity:.5}.section{margin-top:15px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:9px}.stat,.card,.notice{background:var(--p2);border:1px solid var(--b);border-radius:13px;padding:11px}.carousel{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(205px,72%);gap:10px;overflow-x:auto;scroll-snap-type:x mandatory}.card{scroll-snap-align:start}.card-title{font-size:14px;font-weight:760;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.stack{display:grid;gap:8px}.chips{display:flex;gap:7px;overflow-x:auto;padding-bottom:2px}.pill{display:inline-flex;border:1px solid var(--b);border-radius:999px;padding:4px 7px;font-size:10px;color:var(--m);white-space:nowrap}.rank{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--b)}.rank:last-child{border-bottom:0}.rank-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700}.rank-me{color:var(--a)}.footer{padding:9px 15px;border-top:1px solid var(--b);color:var(--m);font-size:10px}.loading{min-height:140px;display:grid;place-items:center;color:var(--m)}@media(max-width:520px){.shell{padding:5px}.head,.content{padding:11px}.carousel{grid-auto-columns:minmax(195px,90%)}}
`;

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function money(value: unknown): string {
  const parsed = num(value);
  const digits = Math.abs(parsed) >= 1000 ? 0 : 2;
  return formatSportfolioBucks(parsed, getOpenAIHost()?.locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
function display(value: unknown): string {
  if (typeof value === "number")
    return new Intl.NumberFormat(getOpenAIHost()?.locale).format(value);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "—";
}
function normalize(value: unknown): Payload | null {
  const root = asRecord(value);
  const structured = asRecord(root.structuredContent);
  const candidate = text(structured.view)
    ? structured
    : text(root.view)
      ? root
      : asRecord(root.data);
  const view = text(candidate.view) as OverviewView;
  if (!["dashboard", "collections", "rankings"].includes(view)) return null;
  return {
    view,
    asOf: text(candidate.asOf, new Date().toISOString()),
    data: asRecord(candidate.data),
    warnings: arr(candidate.warnings).filter((item): item is string => typeof item === "string"),
  };
}
function firstArray(root: JsonRecord, keys: string[]): JsonRecord[] {
  for (const key of keys) {
    if (Array.isArray(root[key])) return arr(root[key]).map(asRecord);
    const child = asRecord(root[key]);
    for (const nestedKey of keys) {
      if (Array.isArray(child[nestedKey])) return arr(child[nestedKey]).map(asRecord);
    }
  }
  return [];
}
function primitiveMetrics(root: JsonRecord, limit = 6): Array<[string, string]> {
  return Object.entries(root)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, limit)
    .map(([key, value]) => [
      key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " "),
      display(value),
    ]);
}
function collectionIdentity(row: JsonRecord) {
  const type = text(row.collectionType || row.type);
  const targetId = text(row.targetId || row.id);
  return { type, targetId, key: `${type}:${targetId}` };
}
function collectionTitle(row: JsonRecord): string {
  return text(
    row.name || row.title || row.displayName || row.targetName || row.targetId,
    "Collection",
  );
}
function completion(row: JsonRecord): string {
  if (typeof row.completed === "boolean") return row.completed ? "Complete" : "In progress";
  const owned = num(row.ownedCount || row.collectedCount || row.currentCount);
  const total = num(row.totalCount || row.requiredCount || row.targetCount);
  if (total > 0) return `${owned}/${total}`;
  return text(row.progress, "In progress");
}

function usePresentation() {
  const [payload, setPayload] = useState<Payload | null>(() =>
    normalize(getHostSnapshot().toolOutput),
  );
  const [state, setState] = useState<LocalState>(
    () => asRecord(getHostSnapshot().widgetState) as LocalState,
  );
  const [busy, setBusy] = useState(false);

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
      } else if (message.method === "ui/notifications/tool-result") {
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
  }, [payload?.view]);

  const patch = (next: Partial<LocalState>) => {
    setState((previous) => {
      const merged = { ...previous, ...next };
      persistWidgetState(merged);
      return merged;
    });
  };

  const invoke = async (name: string, args: JsonRecord, nextState?: Partial<LocalState>) => {
    setBusy(true);
    try {
      const result = await callTool(name, args);
      const next = normalize(result);
      if (next) setPayload(next);
      if (nextState) patch(nextState);
      void updateModelContext(
        { selectedSportfolioView: next?.view || payload?.view, ...nextState },
        `Sportfolio ${next?.view || payload?.view || "overview"} view updated.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return { payload, state, busy, invoke };
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="notice">{children}</div>;
}
function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="head">
      <div>
        <div className="title">{title}</div>
        <div className="sub">{subtitle}</div>
      </div>
      <button className="btn" onClick={() => void requestDisplayMode("fullscreen")}>
        Fullscreen
      </button>
    </header>
  );
}

function Dashboard({ payload }: { payload: Payload }) {
  const dashboard = asRecord(payload.data.dashboard);
  const overview = asRecord(dashboard.overview);
  const portfolio = asRecord(overview.portfolio || dashboard.portfolio || overview);
  const recentLots = firstArray(dashboard, ["recentLots", "lots"]);
  const achievements = firstArray(dashboard, ["achievements", "recentAchievements"]);
  const balance = portfolio.balance ?? portfolio.cashBalance ?? overview.balance;
  const portfolioValue = portfolio.portfolioValue ?? overview.portfolioValue;
  const netWorth = portfolio.netWorth ?? overview.netWorth;
  const pnl = portfolio.pnl ?? portfolio.totalPnl ?? overview.pnl;

  return (
    <div className="panel">
      <Header
        title="Sportfolio dashboard"
        subtitle="Account snapshot, recent positions, and progress"
      />
      <div className="content">
        <div className="grid">
          <Stat label="Net worth" value={money(netWorth)} />
          <Stat label="Portfolio" value={money(portfolioValue)} />
          <Stat label="Cash" value={money(balance)} />
          <Stat label="P&L" value={money(pnl)} />
        </div>
        {primitiveMetrics(asRecord(overview.level || overview.progress), 4).length ? (
          <section className="section">
            <div className="label">Progress</div>
            <div className="grid section">
              {primitiveMetrics(asRecord(overview.level || overview.progress), 4).map(
                ([key, value]) => (
                  <Stat key={key} label={key} value={value} />
                ),
              )}
            </div>
          </section>
        ) : null}
        <section className="section">
          <div className="between">
            <strong>Recent positions</strong>
            <span className="muted">{recentLots.length}</span>
          </div>
          {recentLots.length ? (
            <div className="carousel section">
              {recentLots.slice(0, 8).map((row, index) => {
                const player = asRecord(row.player);
                const name = text(
                  row.playerName || row.name || player.name || player.displayName,
                  "Player position",
                );
                return (
                  <article className="card" key={`${text(row.id || row.playerId)}:${index}`}>
                    <div className="card-title">{name}</div>
                    <div className="sub">
                      {[text(row.team || player.team), text(row.sport || player.sport)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    <div className="stack section">
                      {primitiveMetrics(row, 4).map(([key, value]) => (
                        <div className="between" key={key}>
                          <span className="muted">{key}</span>
                          <strong>{value}</strong>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <Notice>No recent player lots are available.</Notice>
          )}
        </section>
        {achievements.length ? (
          <section className="section">
            <div className="label">Achievements</div>
            <div className="chips section">
              {achievements.slice(0, 10).map((row, index) => (
                <span className="pill" key={`${text(row.id)}:${index}`}>
                  {text(row.name || row.title, "Achievement")}
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </div>
      <footer className="footer">Read-only snapshot from your connected Sportfolio account.</footer>
    </div>
  );
}

function Collections({
  payload,
  busy,
  invoke,
}: {
  payload: Payload;
  busy: boolean;
  invoke: ReturnType<typeof usePresentation>["invoke"];
}) {
  const collectionsRoot = asRecord(payload.data.collections);
  const rows = firstArray(collectionsRoot, ["collections", "items"]);
  const selectedRoot = asRecord(payload.data.selected);
  const selected = asRecord(selectedRoot.collection || selectedRoot);
  const ownedPlayers = firstArray(selectedRoot, ["ownedPlayers", "players"]);

  const openCollection = (row: JsonRecord) => {
    const identity = collectionIdentity(row);
    if (!identity.type || !identity.targetId) return;
    void invoke(
      "render_collections",
      { type: identity.type, targetId: identity.targetId },
      { collectionKey: identity.key },
    );
  };

  return (
    <div className="panel">
      <Header
        title="Sportfolio collections"
        subtitle="Completion progress across your collection sets"
      />
      <div className="content">
        {selected && Object.keys(selected).length ? (
          <section>
            <div className="between">
              <div>
                <div className="label">Selected collection</div>
                <div className="value">{collectionTitle(selected)}</div>
              </div>
              <span className="pill">{completion(selected)}</span>
            </div>
            {ownedPlayers.length ? (
              <div className="chips section">
                {ownedPlayers.slice(0, 12).map((row, index) => (
                  <span className="pill" key={`${text(row.playerId || row.id)}:${index}`}>
                    {`${text(row.firstName)} ${text(row.lastName)}`.trim() ||
                      text(row.name, "Owned player")}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
        <section className="section">
          <div className="between">
            <strong>Your collections</strong>
            <span className="muted">{rows.length}</span>
          </div>
          {rows.length ? (
            <div className="carousel section">
              {rows.map((row, index) => {
                const identity = collectionIdentity(row);
                return (
                  <article className="card" key={`${identity.key}:${index}`}>
                    <div className="card-title">{collectionTitle(row)}</div>
                    <div className="sub">{text(row.collectionType || row.type, "Collection")}</div>
                    <div className="value section">{completion(row)}</div>
                    <button
                      className="btn primary section"
                      style={{ width: "100%" }}
                      disabled={busy || !identity.type || !identity.targetId}
                      onClick={() => openCollection(row)}
                    >
                      Open collection
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <Notice>No collection progress is available yet.</Notice>
          )}
        </section>
      </div>
      <footer className="footer">Collection browsing is read-only in this ChatGPT view.</footer>
    </div>
  );
}

const RANKING_CATEGORIES = [
  ["netWorth", "Net worth"],
  ["portfolioValue", "Portfolio"],
  ["cashBalance", "Cash"],
  ["tradingVolume24h", "24h volume"],
  ["marketOrders", "Orders"],
] as const;

function Rankings({
  payload,
  busy,
  invoke,
}: {
  payload: Payload;
  busy: boolean;
  invoke: ReturnType<typeof usePresentation>["invoke"];
}) {
  const category = text(payload.data.category, "netWorth");
  const rankings = asRecord(payload.data.rankings);
  const rows = firstArray(rankings, ["leaderboard", "top", "entries"]);
  const currentUser = asRecord(rankings.currentUser);
  const around = firstArray(rankings, ["currentUserWindow"]);
  const unit = text(rankings.unit, "currency");
  const formatValue = (value: unknown) =>
    unit === "count" ? Math.round(num(value)).toLocaleString() : money(value);

  const setCategory = (next: string) => {
    void invoke("render_rankings", { category: next, limit: 10 }, { rankingCategory: next });
  };

  return (
    <div className="panel">
      <Header
        title="Sportfolio rankings"
        subtitle={text(rankings.categoryLabel, "Live trader leaderboard")}
      />
      <div className="content">
        <div className="chips">
          {RANKING_CATEGORIES.map(([value, label]) => (
            <button
              key={value}
              className={`btn ${category === value ? "active" : ""}`}
              disabled={busy}
              onClick={() => setCategory(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {Object.keys(currentUser).length ? (
          <section className="section grid">
            <Stat label="Your rank" value={`#${display(currentUser.rank)}`} />
            <Stat
              label={text(rankings.categoryLabel, "Value")}
              value={formatValue(currentUser.value)}
            />
            <Stat label="Competitors" value={display(rankings.totalEntries)} />
          </section>
        ) : null}
        <section className="section">
          <div className="between">
            <strong>Top board</strong>
            <span className="muted">{text(rankings.description)}</span>
          </div>
          {rows.length ? (
            <div className="card section">
              {rows.slice(0, 10).map((row, index) => {
                const isCurrent =
                  Boolean(row.isCurrentUser) || text(row.userId) === text(currentUser.userId);
                return (
                  <div
                    className={`rank ${isCurrent ? "rank-me" : ""}`}
                    key={`${text(row.userId)}:${index}`}
                  >
                    <strong>#{display(row.rank)}</strong>
                    <div className="rank-name">@{text(row.username, "trader")}</div>
                    <strong>{formatValue(row.value)}</strong>
                  </div>
                );
              })}
            </div>
          ) : (
            <Notice>No ranking entries are available.</Notice>
          )}
        </section>
        {around.length ? (
          <section className="section">
            <div className="label">Around you</div>
            <div className="chips section">
              {around.map((row, index) => (
                <span className="pill" key={`${text(row.userId)}:${index}`}>
                  #{display(row.rank)} @{text(row.username, "trader")}
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </div>
      <footer className="footer">
        Rankings use the same live metrics as the Sportfolio website.
      </footer>
    </div>
  );
}

function App() {
  const { payload, busy, invoke } = usePresentation();
  const warningText = useMemo(() => payload?.warnings.join(" · ") || "", [payload?.warnings]);
  if (!payload) return <div className="loading">Loading Sportfolio…</div>;
  return (
    <main className="shell">
      {warningText ? (
        <div className="notice" style={{ marginBottom: 8 }}>
          {warningText}
        </div>
      ) : null}
      {payload.view === "dashboard" ? <Dashboard payload={payload} /> : null}
      {payload.view === "collections" ? (
        <Collections payload={payload} busy={busy} invoke={invoke} />
      ) : null}
      {payload.view === "rankings" ? (
        <Rankings payload={payload} busy={busy} invoke={invoke} />
      ) : null}
    </main>
  );
}

export function mountOverviewWidget(root: HTMLElement) {
  if (!document.getElementById("sportfolio-overview-widget-style")) {
    const style = document.createElement("style");
    style.id = "sportfolio-overview-widget-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  createRoot(root).render(<App />);
}

const root = document.getElementById("root");
if (!root) throw new Error("Sportfolio overview widget root was not found.");
mountOverviewWidget(root);
