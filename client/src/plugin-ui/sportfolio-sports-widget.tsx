import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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

type SportsViewName = "score_slate" | "live_event" | "game_insights";
type SportsPayload = {
  view: SportsViewName;
  asOf: string;
  data: JsonRecord;
  warnings: string[];
};
type SportsWidgetState = {
  view?: SportsViewName;
  sport?: string;
  date?: string;
  status?: string;
  eventId?: string;
};

const SPORTS_VIEWS: SportsViewName[] = ["score_slate", "live_event", "game_insights"];

const CSS = `
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--p:light-dark(#fff,#191c23);--p2:light-dark(#f1f3f7,#222630);--t:light-dark(#151821,#f5f7fb);--m:light-dark(#626a79,#a7aebb);--b:light-dark(#dfe3ea,#303642);--a:light-dark(#3157d5,#8da8ff);--g:light-dark(#087a4b,#4bd59a);--r:light-dark(#b42318,#ff8d86);--live:light-dark(#b42318,#ff8d86)}
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;color:var(--t);background:transparent}button{font:inherit}.shell{padding:8px}.panel{background:var(--p);border:1px solid var(--b);border-radius:18px;overflow:hidden}.head,.between,.team-row{display:flex;justify-content:space-between;gap:12px;align-items:center}.head{padding:15px;border-bottom:1px solid var(--b);align-items:flex-start}.content{padding:15px}.title{font-size:18px;font-weight:760}.sub,.muted{color:var(--m);font-size:12px}.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.btn{border:1px solid var(--b);background:var(--p2);color:var(--t);border-radius:11px;min-height:38px;padding:8px 12px;cursor:pointer;font-weight:650}.btn.primary{background:var(--a);border-color:transparent;color:light-dark(#fff,#10131a)}.btn:disabled{opacity:.5;cursor:not-allowed}.btn:focus-visible{outline:3px solid color-mix(in srgb,var(--a) 35%,transparent);outline-offset:2px}.segments{display:inline-flex;background:var(--p2);border:1px solid var(--b);border-radius:11px;padding:3px;overflow:auto}.segments button{border:0;background:transparent;color:var(--m);border-radius:8px;padding:6px 9px;cursor:pointer;white-space:nowrap}.segments button[aria-pressed=true]{background:var(--p);color:var(--t)}.carousel{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(240px,82%);gap:10px;overflow-x:auto;scroll-snap-type:x mandatory}.game-card,.notice,.metric{background:var(--p2);border:1px solid var(--b);border-radius:14px}.game-card{padding:13px;scroll-snap-align:start}.game-card.live{border-color:color-mix(in srgb,var(--live) 55%,var(--b))}.game-meta{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px}.badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--b);border-radius:999px;padding:4px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}.badge.live{color:var(--live)}.dot{width:6px;height:6px;border-radius:50%;background:currentColor}.team-row{padding:7px 0}.team{font-size:15px;font-weight:720;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.score{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}.score.unknown{color:var(--m)}.section{margin-top:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}.notice{padding:11px}.metric{padding:10px}.label{color:var(--m);font-size:10px;text-transform:uppercase;letter-spacing:.05em}.value{font-size:16px;font-weight:720;margin-top:3px}.owned{margin-top:10px;padding-top:10px;border-top:1px solid var(--b)}.owned-list{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.owned-pill{border:1px solid var(--b);border-radius:999px;padding:4px 7px;font-size:11px}.live-scoreboard{text-align:center;padding:18px 14px}.matchup{display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:center}.matchup-team{font-size:16px;font-weight:750}.matchup-team:last-child{text-align:right}.matchup-score{font-size:30px;font-weight:850;font-variant-numeric:tabular-nums}.live-summary{font-size:14px;font-weight:650;margin-top:9px}.progress{margin-top:12px;color:var(--m);font-size:12px}.footer{padding:9px 15px;border-top:1px solid var(--b);color:var(--m);font-size:10px}.loading{min-height:140px;display:grid;place-items:center;color:var(--m)}body[data-display-mode="pip"] .shell{padding:4px}body[data-display-mode="pip"] .panel{border-radius:12px}body[data-display-mode="pip"] .head{display:none}body[data-display-mode="pip"] .content{padding:8px}body[data-display-mode="pip"] .live-scoreboard{padding:6px}body[data-display-mode="pip"] .matchup-score{font-size:24px}body[data-display-mode="pip"] .section,body[data-display-mode="pip"] .footer,body[data-display-mode="pip"] .pip-hide{display:none}@media(max-width:520px){.shell{padding:5px}.head,.content{padding:11px}.carousel{grid-auto-columns:minmax(225px,92%)}.matchup{grid-template-columns:1fr auto 1fr;gap:8px}.matchup-team{font-size:13px}.matchup-score{font-size:26px}}
`;

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function displayScore(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value;
  return "—";
}

function dateTime(value: unknown): string {
  const parsed = new Date(text(value));
  if (Number.isNaN(parsed.getTime())) return "Time TBD";
  return parsed.toLocaleTimeString(getOpenAIHost()?.locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fullDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value || "Today";
  return parsed.toLocaleDateString(getOpenAIHost()?.locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function shiftDate(value: string, days: number): string {
  const base = value ? new Date(`${value}T12:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return value;
  base.setDate(base.getDate() + days);
  const year = base.getFullYear();
  const month = String(base.getMonth() + 1).padStart(2, "0");
  const day = String(base.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalize(value: unknown): SportsPayload | null {
  const root = asRecord(value);
  const structured = asRecord(root.structuredContent);
  const candidate = text(structured.view)
    ? structured
    : text(root.view)
      ? root
      : asRecord(root.data);
  const view = text(candidate.view) as SportsViewName;
  if (!SPORTS_VIEWS.includes(view)) return null;
  return {
    view,
    asOf: text(candidate.asOf, new Date().toISOString()),
    data: asRecord(candidate.data),
    warnings: arr(candidate.warnings).filter((item): item is string => typeof item === "string"),
  };
}

function useSportsPresentation() {
  const [payload, setPayload] = useState<SportsPayload | null>(() =>
    normalize(getHostSnapshot().toolOutput),
  );
  const [widgetState, setWidgetState] = useState<SportsWidgetState>(
    () => asRecord(getHostSnapshot().widgetState) as SportsWidgetState,
  );
  const [displayMode, setDisplayMode] = useState(text(getHostSnapshot().displayMode, "inline"));

  useEffect(() => {
    const syncDisplayMode = (mode: unknown) => {
      const next = text(mode, "inline");
      setDisplayMode(next);
      document.body.dataset.displayMode = next;
    };
    syncDisplayMode(getHostSnapshot().displayMode);

    const unsubscribe = subscribeHostMessages((message) => {
      if (message.method === "openai:set_globals") {
        const params = asRecord(message.params);
        const globals = asRecord(params.globals);
        const next = normalize(
          globals.toolOutput ?? params.toolOutput ?? getHostSnapshot().toolOutput,
        );
        if (next) setPayload(next);
        const nextState = asRecord(globals.widgetState ?? params.widgetState);
        if (Object.keys(nextState).length) setWidgetState(nextState as SportsWidgetState);
        syncDisplayMode(globals.displayMode ?? params.displayMode ?? getHostSnapshot().displayMode);
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

  const update = useCallback((next: SportsPayload) => {
    setPayload(next);
    setWidgetState((previous) => {
      const state = { ...previous, view: next.view };
      persistWidgetState(state);
      return state;
    });
  }, []);

  const updateState = useCallback(
    (patch: Partial<SportsWidgetState>, modelContext?: JsonRecord, contextText?: string) => {
      setWidgetState((previous) => {
        const state = { ...previous, ...patch };
        persistWidgetState(state);
        return state;
      });
      if (modelContext) void updateModelContext(modelContext, contextText);
    },
    [],
  );

  return { payload, update, widgetState, updateState, displayMode };
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="notice">{children}</div>;
}

function Badge({ status }: { status: string }) {
  const label = status.replaceAll("_", " ");
  const live = status === "in_progress";
  return (
    <span className={`badge${live ? " live" : ""}`}>
      {live ? <span className="dot" /> : null}
      {live ? "Live" : label || "Unknown"}
    </span>
  );
}

function OwnedContext({ value }: { value: JsonRecord }) {
  const players = arr(value.ownedPlayers).map(asRecord);
  const boostCount = Number(value.boostCount || 0);
  if (!players.length && !boostCount) return null;
  return (
    <div className="owned">
      <div className="label">Your Sportfolio exposure</div>
      <div className="owned-list">
        {players.slice(0, 5).map((player) => (
          <span className="owned-pill" key={text(player.id, text(player.name))}>
            {text(player.name, "Owned player")}
          </span>
        ))}
        {boostCount > 0 ? (
          <span className="owned-pill">
            {boostCount} active boost{boostCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

type SportsViewProps = ReturnType<typeof useSportsPresentation> & {
  payload: SportsPayload;
};

function GameCard({
  game,
  onOpen,
  onSelect,
}: {
  game: JsonRecord;
  onOpen: (game: JsonRecord) => void;
  onSelect: (game: JsonRecord) => void;
}) {
  const status = text(game.status, "unknown");
  const homeScore = displayScore(game.homeScore);
  const awayScore = displayScore(game.awayScore);
  const scoreKnown = homeScore !== "—" || awayScore !== "—";
  const eventId = text(game.gameId);
  const sport = text(game.sport);
  const home = text(game.homeTeam, "Home");
  const away = text(game.awayTeam, "Away");
  const userContext = asRecord(game.userContext);

  return (
    <article
      className={`game-card${status === "in_progress" ? " live" : ""}`}
      onClick={() => onSelect(game)}
    >
      <div className="game-meta">
        <Badge status={status} />
        <span className="muted">
          {status === "scheduled" ? dateTime(game.startTime) : sport.toUpperCase()}
        </span>
      </div>
      <div className="team-row">
        <span className="team">{away}</span>
        <span className={`score${awayScore === "—" ? " unknown" : ""}`}>{awayScore}</span>
      </div>
      <div className="team-row">
        <span className="team">{home}</span>
        <span className={`score${homeScore === "—" ? " unknown" : ""}`}>{homeScore}</span>
      </div>
      {!scoreKnown && status !== "scheduled" ? (
        <div className="muted">Score unavailable from the current source.</div>
      ) : null}
      <OwnedContext value={userContext} />
      <div className="row section">
        {status === "in_progress" && eventId ? (
          <button
            className="btn primary"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(game);
            }}
          >
            Follow live
          </button>
        ) : null}
        <button
          className="btn"
          onClick={(event) => {
            event.stopPropagation();
            void sendFollowUpMessage(
              `Analyze the ${sport.toUpperCase()} game ${away} at ${home} in Sportfolio.`,
            );
          }}
        >
          Analyze
        </button>
      </div>
    </article>
  );
}

function ScoreSlate({ payload, update, widgetState, updateState, displayMode }: SportsViewProps) {
  const data = payload.data;
  const games = arr(data.games).map(asRecord);
  const date = text(data.date, widgetState.date || "");
  const sport = text(data.sport, widgetState.sport || "ALL").toLowerCase();
  const currentStatus = text(asRecord(data.filters).status, widgetState.status || "");
  const fullscreen = displayMode === "fullscreen";
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (nextDate = date, nextStatus = currentStatus) => {
      setBusy(true);
      try {
        const next = normalize(
          await callTool("render_score_slate", {
            ...(sport && sport !== "all" ? { sport } : {}),
            ...(nextDate ? { date: nextDate } : {}),
            ...(nextStatus ? { status: nextStatus } : {}),
            limit: fullscreen ? 50 : 8,
          }),
        );
        if (next) {
          updateState({ sport, date: nextDate, status: nextStatus });
          update(next);
        }
      } finally {
        setBusy(false);
      }
    },
    [currentStatus, date, fullscreen, sport, update, updateState],
  );

  const selectGame = (game: JsonRecord) => {
    const eventId = text(game.gameId);
    updateState(
      { eventId, sport: text(game.sport, sport), date },
      {
        selectedEventId: eventId,
        selectedSport: text(game.sport, sport),
        selectedEventStatus: text(game.status),
      },
      `Sportfolio widget selection: ${text(game.awayTeam, "Away")} at ${text(game.homeTeam, "Home")}, ${text(game.status, "unknown")} (${eventId}).`,
    );
  };

  const openLive = async (game: JsonRecord) => {
    selectGame(game);
    const next = normalize(
      await callTool("render_live_event", {
        sport: text(game.sport, sport),
        eventId: text(game.gameId),
        ...(date ? { date } : {}),
      }),
    );
    if (next) update(next);
  };

  const cards = games.map((game) => (
    <GameCard
      key={`${text(game.sport)}:${text(game.gameId)}`}
      game={game}
      onOpen={(selected) => void openLive(selected)}
      onSelect={selectGame}
    />
  ));

  return (
    <div className="panel">
      <header className="head">
        <div>
          <div className="title">Sportfolio scores</div>
          <div className="sub">
            {fullDate(date)} · {sport === "all" ? "All sports" : sport.toUpperCase()}
          </div>
        </div>
        <div className="row">
          {!fullscreen ? (
            <button className="btn primary" onClick={() => void requestDisplayMode("fullscreen")}>
              Full slate
            </button>
          ) : null}
          <button className="btn" disabled={busy} onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </header>
      <div className="content">
        {fullscreen ? (
          <div className="between pip-hide" style={{ marginBottom: 12 }}>
            <div className="row">
              <button
                className="btn"
                disabled={busy}
                onClick={() => void load(shiftDate(date, -1))}
              >
                Previous
              </button>
              <button className="btn" disabled={busy} onClick={() => void load(shiftDate(date, 1))}>
                Next
              </button>
            </div>
            <div className="segments">
              {["", "scheduled", "in_progress", "final"].map((status) => (
                <button
                  key={status || "all"}
                  aria-pressed={currentStatus === status}
                  disabled={busy}
                  onClick={() => void load(date, status)}
                >
                  {status ? status.replaceAll("_", " ") : "All"}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {games.length ? (
          fullscreen ? (
            <div className="grid">{cards}</div>
          ) : (
            <div className="carousel">{cards}</div>
          )
        ) : (
          <Notice>No games match this slate.</Notice>
        )}
        {data.hasMore === true && !fullscreen ? (
          <div className="section">
            <button className="btn" onClick={() => void requestDisplayMode("fullscreen")}>
              View all games
            </button>
          </div>
        ) : null}
      </div>
      <footer className="footer">
        Scores remain unknown when the source does not provide them. Updated{" "}
        {new Date(payload.asOf).toLocaleTimeString(getOpenAIHost()?.locale)}.
      </footer>
    </div>
  );
}

function LiveEvent({ payload, update, updateState, displayMode }: SportsViewProps) {
  const data = payload.data;
  const game = asRecord(data.game);
  const liveState = asRecord(data.liveState);
  const sport = text(data.sport, text(game.sport));
  const eventId = text(data.eventId, text(game.gameId));
  const status = text(liveState.status, text(game.status, "unknown"));
  const date = text(asRecord(getHostSnapshot().widgetState).date);
  const phase = asRecord(liveState.phase);
  const progress = asRecord(liveState.progress);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!eventId || !sport) return;
    setRefreshing(true);
    try {
      const next = normalize(
        await callTool("render_live_event", {
          sport,
          eventId,
          ...(date ? { date } : {}),
        }),
      );
      if (next) update(next);
    } finally {
      setRefreshing(false);
    }
  }, [date, eventId, sport, update]);

  useEffect(() => {
    updateState(
      { view: "live_event", eventId, sport, ...(date ? { date } : {}) },
      { selectedEventId: eventId, selectedSport: sport, selectedEventStatus: status },
      `Sportfolio live event selection: ${sport.toUpperCase()} ${eventId}, status ${status}.`,
    );
  }, [eventId, sport, status]);

  useEffect(() => {
    if (status !== "in_progress") return;
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(timer);
  }, [refresh, status]);

  const away = text(game.awayTeam, "Away");
  const home = text(game.homeTeam, "Home");
  const awayScore = displayScore(game.awayScore);
  const homeScore = displayScore(game.homeScore);
  const phaseLabel = text(phase.label) || text(liveState.period) || text(liveState.clock);
  const progressCurrent = progress.current;
  const progressTotal = progress.total;

  return (
    <div className="panel">
      <header className="head">
        <div>
          <div className="row">
            <Badge status={status} />
            <span className="sub">{sport.toUpperCase()}</span>
          </div>
          <div className="title section">Live Sportfolio event</div>
        </div>
        <div className="row">
          {status === "in_progress" && displayMode !== "pip" ? (
            <button className="btn primary" onClick={() => void requestDisplayMode("pip")}>
              Follow in PiP
            </button>
          ) : null}
          <button className="btn" disabled={refreshing} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </header>
      <div className="content">
        <div className="live-scoreboard">
          <div className="matchup">
            <div className="matchup-team">{away}</div>
            <div className="matchup-score">
              <span className={awayScore === "—" ? "muted" : ""}>{awayScore}</span>
              <span className="muted"> – </span>
              <span className={homeScore === "—" ? "muted" : ""}>{homeScore}</span>
            </div>
            <div className="matchup-team">{home}</div>
          </div>
          {text(liveState.summary) ? (
            <div className="live-summary">{text(liveState.summary)}</div>
          ) : null}
          {phaseLabel ? <div className="progress">{phaseLabel}</div> : null}
          {progressCurrent != null || progressTotal != null ? (
            <div className="progress">
              {progressCurrent != null ? String(progressCurrent) : "?"}
              {progressTotal != null ? ` / ${String(progressTotal)}` : ""} {text(progress.unit)}
            </div>
          ) : null}
        </div>
        <OwnedContext value={asRecord(game.userContext)} />
        <div className="row section pip-hide">
          <button
            className="btn"
            onClick={() =>
              void sendFollowUpMessage(
                `Analyze what is happening in the ${sport.toUpperCase()} event ${away} at ${home} and how it affects my Sportfolio players.`,
              )
            }
          >
            Analyze live game
          </button>
          {displayMode === "pip" ? null : (
            <button className="btn" onClick={() => void requestDisplayMode("fullscreen")}>
              Fullscreen
            </button>
          )}
        </div>
      </div>
      <footer className="footer">
        Live state refreshes only while the event is in progress. Updated{" "}
        {new Date(payload.asOf).toLocaleTimeString(getOpenAIHost()?.locale)}.
      </footer>
    </div>
  );
}

function GameInsights({ payload, update, updateState }: SportsViewProps) {
  const games = arr(payload.data.games).map(asRecord);
  const sport = text(payload.data.sport).toLowerCase();
  const date = text(payload.data.date);
  const openLive = async (game: JsonRecord) => {
    const eventId = text(game.gameId);
    updateState(
      { eventId, sport, date },
      { selectedEventId: eventId, selectedSport: sport, selectedEventStatus: text(game.status) },
      `Sportfolio game insight selection: ${text(game.awayTeam)} at ${text(game.homeTeam)} (${eventId}).`,
    );
    const next = normalize(
      await callTool("render_live_event", { sport, eventId, ...(date ? { date } : {}) }),
    );
    if (next) update(next);
  };

  return (
    <div className="panel">
      <header className="head">
        <div>
          <div className="title">Your Sportfolio game slate</div>
          <div className="sub">
            {sport.toUpperCase()} · {fullDate(date)}
          </div>
        </div>
        <button className="btn" onClick={() => void requestDisplayMode("fullscreen")}>
          Fullscreen
        </button>
      </header>
      <div className="content">
        {games.length ? (
          <div className="carousel">
            {games.map((game) => (
              <GameCard
                key={text(game.gameId)}
                game={game}
                onOpen={(selected) => void openLive(selected)}
                onSelect={(selected) => {
                  const eventId = text(selected.gameId);
                  updateState(
                    { eventId, sport, date },
                    { selectedEventId: eventId, selectedSport: sport },
                  );
                }}
              />
            ))}
          </div>
        ) : (
          <Notice>No personalized game rows are available for this slate.</Notice>
        )}
      </div>
      <footer className="footer">Connected Sportfolio gameplay context only.</footer>
    </div>
  );
}

function App() {
  const presentation = useSportsPresentation();
  const { payload } = presentation;
  const view = useMemo(() => {
    if (!payload) return null;
    if (payload.view === "score_slate") {
      return <ScoreSlate {...presentation} payload={payload} />;
    }
    if (payload.view === "live_event") {
      return <LiveEvent {...presentation} payload={payload} />;
    }
    return <GameInsights {...presentation} payload={payload} />;
  }, [payload, presentation]);

  return (
    <>
      <style>{CSS}</style>
      <main className="shell">
        {payload?.warnings.map((warning) => (
          <Notice key={warning}>{warning}</Notice>
        ))}
        {view || <div className="panel loading">Loading Sportfolio scores…</div>}
      </main>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Sportfolio sports widget root was not found.");
createRoot(root).render(<App />);
