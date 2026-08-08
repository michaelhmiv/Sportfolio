import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
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

type GameplayView = "scouting" | "boosts" | "watchlist";
type Payload = { view: GameplayView; asOf: string; data: JsonRecord; warnings: string[] };
type LocalState = {
  view?: GameplayView;
  sport?: string;
  watchlistId?: string;
  selectedPlayerId?: string;
};

const CSS = `
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--p:light-dark(#fff,#191c23);--p2:light-dark(#f1f3f7,#222630);--t:light-dark(#151821,#f5f7fb);--m:light-dark(#626a79,#a7aebb);--b:light-dark(#dfe3ea,#303642);--a:light-dark(#3157d5,#8da8ff);--g:light-dark(#087a4b,#4bd59a);--r:light-dark(#b42318,#ff8d86)}
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;color:var(--t);background:transparent}button,select{font:inherit}.shell{padding:8px}.panel{background:var(--p);border:1px solid var(--b);border-radius:18px;overflow:hidden}.head,.between,.row{display:flex;gap:10px;align-items:center}.head,.between{justify-content:space-between}.head{padding:15px;border-bottom:1px solid var(--b);align-items:flex-start}.content{padding:15px}.title{font-size:18px;font-weight:780}.sub,.muted{font-size:12px;color:var(--m)}.label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--m)}.value{font-size:17px;font-weight:740;margin-top:3px}.btn{border:1px solid var(--b);background:var(--p2);color:var(--t);border-radius:11px;min-height:38px;padding:8px 12px;cursor:pointer;font-weight:650}.btn.primary{background:var(--a);border-color:transparent;color:light-dark(#fff,#10131a)}.btn:disabled{opacity:.5}.section{margin-top:15px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px}.stat,.card,.notice{background:var(--p2);border:1px solid var(--b);border-radius:13px;padding:11px}.carousel{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(215px,78%);gap:10px;overflow-x:auto;scroll-snap-type:x mandatory}.card{scroll-snap-align:start}.player-name{font-size:15px;font-weight:760}.pill{display:inline-flex;border:1px solid var(--b);border-radius:999px;padding:4px 7px;font-size:10px;color:var(--m)}.stack{display:grid;gap:8px}.select{min-height:38px;border:1px solid var(--b);border-radius:10px;background:var(--p);color:var(--t);padding:7px 9px}.footer{padding:9px 15px;border-top:1px solid var(--b);color:var(--m);font-size:10px}.loading{min-height:140px;display:grid;place-items:center;color:var(--m)}@media(max-width:520px){.shell{padding:5px}.head,.content{padding:11px}.carousel{grid-auto-columns:minmax(205px,92%)}}
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
function display(value: unknown): string {
  if (typeof value === "number")
    return new Intl.NumberFormat(getOpenAIHost()?.locale, { maximumFractionDigits: 2 }).format(
      value,
    );
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
  const view = text(candidate.view) as GameplayView;
  if (!["scouting", "boosts", "watchlist"].includes(view)) return null;
  return {
    view,
    asOf: text(candidate.asOf, new Date().toISOString()),
    data: asRecord(candidate.data),
    warnings: arr(candidate.warnings).filter((item): item is string => typeof item === "string"),
  };
}

const PLAYER_KEYS = [
  "player",
  "players",
  "candidates",
  "eligiblePlayers",
  "opportunities",
  "assignments",
  "roster",
  "items",
];
function rowsFrom(value: unknown, depth = 0): JsonRecord[] {
  if (depth > 3) return [];
  if (Array.isArray(value)) return value.map(asRecord).filter((item) => Object.keys(item).length);
  const root = asRecord(value);
  for (const key of PLAYER_KEYS) {
    const child = root[key];
    if (Array.isArray(child) && child.length) return child.map(asRecord);
    if (child && typeof child === "object") {
      const nested = rowsFrom(child, depth + 1);
      if (nested.length) return nested;
    }
  }
  for (const child of Object.values(root)) {
    if (Array.isArray(child) && child.length) return child.map(asRecord);
  }
  return [];
}
function idOf(row: JsonRecord): string {
  const player = asRecord(row.player);
  return text(row.playerId || row.id || player.playerId || player.id);
}
function nameOf(row: JsonRecord): string {
  const player = asRecord(row.player);
  return text(
    row.displayName || row.playerName || row.name || player.displayName || player.name,
    "Player",
  );
}
function subtitleOf(row: JsonRecord): string {
  const player = asRecord(row.player);
  return [
    text(row.team || player.team),
    text(row.position || player.position),
    text(row.sport || player.sport),
  ]
    .filter(Boolean)
    .join(" · ");
}
function compactMetrics(row: JsonRecord): Array<[string, string]> {
  const ignored = new Set([
    "id",
    "playerId",
    "name",
    "displayName",
    "playerName",
    "player",
    "team",
    "position",
    "sport",
    "imageUrl",
  ]);
  return Object.entries(row)
    .filter(
      ([key, value]) =>
        !ignored.has(key) &&
        (typeof value === "string" || typeof value === "number" || typeof value === "boolean"),
    )
    .slice(0, 3)
    .map(([key, value]) => [
      key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " "),
      display(value),
    ]);
}
function summaryMetrics(value: JsonRecord): Array<[string, string]> {
  return Object.entries(value)
    .filter(
      ([, item]) =>
        typeof item === "number" || typeof item === "string" || typeof item === "boolean",
    )
    .slice(0, 6)
    .map(([key, item]) => [
      key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " "),
      display(item),
    ]);
}

function usePresentation() {
  const [payload, setPayload] = useState<Payload | null>(() =>
    normalize(getHostSnapshot().toolOutput),
  );
  const [state, setState] = useState<LocalState>(
    () => asRecord(getHostSnapshot().widgetState) as LocalState,
  );
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
  const patch = (next: Partial<LocalState>, context?: JsonRecord, contextText?: string) => {
    setState((previous) => {
      const merged = { ...previous, ...next };
      persistWidgetState(merged);
      return merged;
    });
    if (context) void updateModelContext(context, contextText);
  };
  return { payload, setPayload, state, patch };
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
function PlayerCard({
  row,
  action,
  onSelect,
}: {
  row: JsonRecord;
  action: string;
  onSelect: (row: JsonRecord) => void;
}) {
  const name = nameOf(row);
  const id = idOf(row);
  return (
    <article className="card">
      <div className="player-name">{name}</div>
      {subtitleOf(row) ? <div className="sub">{subtitleOf(row)}</div> : null}
      <div className="stack section">
        {compactMetrics(row).map(([key, value]) => (
          <div className="between" key={key}>
            <span className="muted">{key}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <button
        className="btn primary section"
        style={{ width: "100%" }}
        onClick={() => onSelect(row)}
      >
        {action}
      </button>
      {id ? <div className="muted section">Sportfolio player</div> : null}
    </article>
  );
}

function Scouting({
  payload,
  patch,
}: {
  payload: Payload;
  patch: ReturnType<typeof usePresentation>["patch"];
}) {
  const data = payload.data;
  const status = asRecord(data.status);
  const assignments = rowsFrom(data.assignments);
  const opportunities = rowsFrom(data.opportunities);
  const metrics = summaryMetrics(status);
  const select = (row: JsonRecord) => {
    const id = idOf(row);
    const name = nameOf(row);
    patch(
      { selectedPlayerId: id },
      { selectedPlayerId: id, selectedGameplayView: "scouting" },
      `Sportfolio scouting candidate selected: ${name}.`,
    );
    void sendFollowUpMessage(
      `Scout ${name} in Sportfolio. Show me the staged assignment before I confirm it.`,
    );
  };
  return (
    <div className="panel">
      <header className="head">
        <div>
          <div className="title">Sportfolio scouting</div>
          <div className="sub">Assignments, capacity, and current opportunities</div>
        </div>
        <button className="btn" onClick={() => void requestDisplayMode("fullscreen")}>
          Fullscreen
        </button>
      </header>
      <div className="content">
        {metrics.length ? (
          <div className="grid">
            {metrics.map(([key, value]) => (
              <Stat key={key} label={key} value={value} />
            ))}
          </div>
        ) : null}
        {assignments.length ? (
          <section className="section">
            <h3>Current assignments</h3>
            <div className="carousel">
              {assignments.slice(0, 8).map((row, index) => (
                <PlayerCard
                  key={`${idOf(row)}:${index}`}
                  row={row}
                  action="Review player"
                  onSelect={(item) =>
                    void sendFollowUpMessage(
                      `Review ${nameOf(item)} and my current Sportfolio scouting assignment.`,
                    )
                  }
                />
              ))}
            </div>
          </section>
        ) : null}
        <section className="section">
          <h3>Scouting opportunities</h3>
          {opportunities.length ? (
            <div className="carousel">
              {opportunities.slice(0, 8).map((row, index) => (
                <PlayerCard
                  key={`${idOf(row)}:${index}`}
                  row={row}
                  action="Scout player"
                  onSelect={select}
                />
              ))}
            </div>
          ) : (
            <Notice>No scouting opportunities are currently available.</Notice>
          )}
        </section>
      </div>
      <footer className="footer">
        Scouting changes use the staged Sportfolio confirmation flow.
      </footer>
    </div>
  );
}

function Boosts({
  payload,
  patch,
}: {
  payload: Payload;
  patch: ReturnType<typeof usePresentation>["patch"];
}) {
  const data = payload.data;
  const activeRows = rowsFrom(data.active);
  const candidateRows = rowsFrom(data.candidates).length
    ? rowsFrom(data.candidates)
    : rowsFrom(data.eligible);
  const community = asRecord(data.community);
  const select = (row: JsonRecord) => {
    const id = idOf(row);
    const name = nameOf(row);
    patch(
      { selectedPlayerId: id },
      { selectedPlayerId: id, selectedGameplayView: "boosts" },
      `Sportfolio boost candidate selected: ${name}.`,
    );
    void sendFollowUpMessage(
      `Assign an available daily boost to ${name} in Sportfolio. Stage it and let me review it before confirmation.`,
    );
  };
  return (
    <div className="panel">
      <header className="head">
        <div>
          <div className="title">Sportfolio boosts</div>
          <div className="sub">Daily boost slots and eligible players</div>
        </div>
        <button className="btn" onClick={() => void requestDisplayMode("fullscreen")}>
          Fullscreen
        </button>
      </header>
      <div className="content">
        {summaryMetrics(community).length ? (
          <div className="grid">
            {summaryMetrics(community).map(([key, value]) => (
              <Stat key={key} label={`Community ${key}`} value={value} />
            ))}
          </div>
        ) : null}
        {activeRows.length ? (
          <section className="section">
            <h3>Active boosts</h3>
            <div className="carousel">
              {activeRows.slice(0, 8).map((row, index) => (
                <PlayerCard
                  key={`${idOf(row)}:${index}`}
                  row={row}
                  action="Review boost"
                  onSelect={(item) =>
                    void sendFollowUpMessage(
                      `Review the active Sportfolio boost on ${nameOf(item)}.`,
                    )
                  }
                />
              ))}
            </div>
          </section>
        ) : null}
        <section className="section">
          <h3>Eligible players</h3>
          {candidateRows.length ? (
            <div className="carousel">
              {candidateRows.slice(0, 8).map((row, index) => (
                <PlayerCard
                  key={`${idOf(row)}:${index}`}
                  row={row}
                  action="Boost player"
                  onSelect={select}
                />
              ))}
            </div>
          ) : (
            <Notice>No eligible boost candidates are available for this view.</Notice>
          )}
        </section>
      </div>
      <footer className="footer">
        Boost assignments remain staged actions and require explicit confirmation.
      </footer>
    </div>
  );
}

function Watchlist({
  payload,
  setPayload,
  state,
  patch,
}: {
  payload: Payload;
  setPayload: (payload: Payload | null) => void;
  state: LocalState;
  patch: ReturnType<typeof usePresentation>["patch"];
}) {
  const data = payload.data;
  const watchlists = rowsFrom(data.watchlists);
  const items = rowsFrom(data.items);
  const currentId = text(data.watchlistId, state.watchlistId || "");
  const switchList = async (watchlistId: string) => {
    patch(
      { watchlistId },
      { selectedWatchlistId: watchlistId },
      `Sportfolio watchlist selected: ${watchlistId}.`,
    );
    const next = normalize(await callTool("render_watchlist", { watchlistId, limit: 20 }));
    if (next) setPayload(next);
  };
  const open = (row: JsonRecord) => {
    const id = idOf(row);
    const name = nameOf(row);
    patch(
      { selectedPlayerId: id },
      { selectedPlayerId: id, selectedGameplayView: "watchlist" },
      `Sportfolio watchlist player selected: ${name}.`,
    );
    void sendFollowUpMessage(`Open and analyze ${name}'s Sportfolio market.`);
  };
  return (
    <div className="panel">
      <header className="head">
        <div>
          <div className="title">Sportfolio watchlists</div>
          <div className="sub">Track players and jump directly into market analysis</div>
        </div>
        <button className="btn" onClick={() => void requestDisplayMode("fullscreen")}>
          Fullscreen
        </button>
      </header>
      <div className="content">
        {watchlists.length > 1 ? (
          <div className="row">
            <span className="label">Watchlist</span>
            <select
              className="select"
              value={currentId}
              onChange={(event) => void switchList(event.target.value)}
            >
              {watchlists.map((list, index) => {
                const id = text(list.watchlistId || list.id);
                return (
                  <option key={`${id}:${index}`} value={id}>
                    {text(list.name, `Watchlist ${index + 1}`)}
                  </option>
                );
              })}
            </select>
          </div>
        ) : null}
        <section className="section">
          {items.length ? (
            <div className="carousel">
              {items.slice(0, 12).map((row, index) => (
                <PlayerCard
                  key={`${idOf(row)}:${index}`}
                  row={row}
                  action="Analyze player"
                  onSelect={open}
                />
              ))}
            </div>
          ) : (
            <Notice>This watchlist has no players to display.</Notice>
          )}
        </section>
        <div className="row section">
          <button
            className="btn"
            onClick={() => void sendFollowUpMessage("Help me manage my Sportfolio watchlists.")}
          >
            Manage watchlists
          </button>
        </div>
      </div>
      <footer className="footer">Watchlist edits use the existing Sportfolio account tools.</footer>
    </div>
  );
}

function App() {
  const presentation = usePresentation();
  const payload = presentation.payload;
  const view = useMemo(() => {
    if (!payload) return null;
    if (payload.view === "scouting")
      return <Scouting payload={payload} patch={presentation.patch} />;
    if (payload.view === "boosts") return <Boosts payload={payload} patch={presentation.patch} />;
    return (
      <Watchlist
        payload={payload}
        setPayload={presentation.setPayload}
        state={presentation.state}
        patch={presentation.patch}
      />
    );
  }, [payload, presentation.state]);
  return (
    <>
      <style>{CSS}</style>
      <main className="shell">
        {payload?.warnings.map((warning) => (
          <Notice key={warning}>{warning}</Notice>
        ))}
        {view || <div className="panel loading">Loading Sportfolio gameplay…</div>}
      </main>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Sportfolio gameplay widget root was not found.");
createRoot(root).render(<App />);
