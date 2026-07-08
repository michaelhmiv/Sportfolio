import type { MlbPregameInsight } from "./mlb-pregame-insights";

type GameStatus = "scheduled" | "inprogress" | "completed" | "postponed" | string;

export type MlbGameplaySignalCategory =
  | "lineup"
  | "pitcher"
  | "statcast"
  | "market"
  | "weather"
  | "team"
  | "scoring"
  | "game_state";

export type MlbGameplaySignalSeverity = "info" | "positive" | "warning" | "high";

export type MlbGameplaySignal = {
  id: string;
  gameId: string;
  playerId?: string;
  team?: string;
  category: MlbGameplaySignalCategory;
  severity: MlbGameplaySignalSeverity;
  label: string;
  detail: string;
  scoreImpact?: number;
};

type SignalGameContext = {
  gameId: string;
  status: GameStatus;
  awayTeam: string;
  homeTeam: string;
};

type SignalLeader = {
  name: string;
  team: string;
  avgFantasyPointsPerGame?: number | null;
  totalShares?: number | null;
  scoutCount?: number | null;
} | null;

type SignalUserContext = {
  eligibleCount?: number | null;
  ownedPlayers?: Array<{ playerId: string; name: string; team: string; isBoosted?: boolean }>;
} | null;

type BuildMlbGameplaySignalsInput = {
  game: SignalGameContext;
  mlbPregame: MlbPregameInsight | null;
  leaders?: {
    fantasy?: SignalLeader;
    shares?: SignalLeader;
    scouts?: SignalLeader;
  };
  userContext?: SignalUserContext;
};

function compactText(value: string | null | undefined): string | null {
  const text = String(value || "").trim();
  return text.length > 0 ? text : null;
}

function teamLabel(side: "away" | "home", game: SignalGameContext) {
  return side === "away" ? game.awayTeam : game.homeTeam;
}

function makeSignal(
  gameId: string,
  category: MlbGameplaySignalCategory,
  severity: MlbGameplaySignalSeverity,
  label: string,
  detail: string,
  options: { team?: string; playerId?: string; scoreImpact?: number } = {},
): MlbGameplaySignal {
  const slug = [category, label, options.team, options.playerId]
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    id: `${gameId}:${slug}`,
    gameId,
    category,
    severity,
    label,
    detail,
    ...options,
  };
}

function addProbablePitcherSignals(
  signals: MlbGameplaySignal[],
  game: SignalGameContext,
  mlbPregame: MlbPregameInsight,
) {
  (["away", "home"] as const).forEach((side) => {
    const pitcher = mlbPregame.probablePitchers[side];
    const stats = mlbPregame.probablePitcherStats[side];
    if (!pitcher) return;

    const team = teamLabel(side, game);
    const opposingTeam = teamLabel(side === "away" ? "home" : "away", game);
    const statDetail = stats?.summary ? ` ${stats.summary}` : "";
    const xera = stats?.xera ?? null;
    const severity: MlbGameplaySignalSeverity = xera != null && xera <= 3.5 ? "high" : "info";
    const scoreImpact = xera != null ? Math.max(-2, Math.min(2, 4.25 - xera)) : undefined;

    signals.push(
      makeSignal(
        game.gameId,
        "pitcher",
        severity,
        `${team} probable: ${pitcher.name}`,
        `${opposingTeam} hitters are projected against ${pitcher.name}.${statDetail}`.trim(),
        { team, scoreImpact },
      ),
    );
  });
}

function addLineupSignals(
  signals: MlbGameplaySignal[],
  game: SignalGameContext,
  mlbPregame: MlbPregameInsight,
) {
  if (mlbPregame.lineupsPosted) {
    signals.push(
      makeSignal(
        game.gameId,
        "lineup",
        "positive",
        "Lineups posted",
        "Starting lineups are available, so boost/scout decisions can use confirmed batting order context.",
        { scoreImpact: 1.25 },
      ),
    );
  } else if (game.status === "scheduled") {
    signals.push(
      makeSignal(
        game.gameId,
        "lineup",
        "warning",
        "Lineups pending",
        "Starting lineups are not posted yet; pregame player signals should be treated as provisional.",
        { scoreImpact: -0.75 },
      ),
    );
  }

  (["away", "home"] as const).forEach((side) => {
    const detail = compactText(mlbPregame.lineupSignals[side]);
    if (!detail) return;
    signals.push(
      makeSignal(
        game.gameId,
        "lineup",
        "positive",
        `${teamLabel(side, game)} lineup note`,
        detail,
        {
          team: teamLabel(side, game),
          scoreImpact: 0.75,
        },
      ),
    );
  });
}

function addStatcastSignals(
  signals: MlbGameplaySignal[],
  game: SignalGameContext,
  mlbPregame: MlbPregameInsight,
) {
  if (mlbPregame.advancedStatsAvailable) {
    signals.push(
      makeSignal(
        game.gameId,
        "statcast",
        "positive",
        "Expected stats available",
        "This matchup has Statcast expected-stat context for probable pitchers and lineup bats.",
        { scoreImpact: 0.75 },
      ),
    );
  }

  (["away", "home"] as const).forEach((side) => {
    mlbPregame.hitterSpotlights[side].slice(0, 2).forEach((spotlight) => {
      const team = spotlight.team || teamLabel(side, game);
      signals.push(
        makeSignal(
          game.gameId,
          "statcast",
          "positive",
          `${spotlight.name} expected-stat spotlight`,
          spotlight.summary,
          { team, scoreImpact: 1 },
        ),
      );
    });
  });
}

function addGameStateSignals(
  signals: MlbGameplaySignal[],
  game: SignalGameContext,
  mlbPregame: MlbPregameInsight,
) {
  const weather = compactText(mlbPregame.weatherSummary || mlbPregame.gameState?.weatherSummary);
  if (weather) {
    signals.push(
      makeSignal(game.gameId, "weather", "info", "Weather context", weather, { scoreImpact: 0.25 }),
    );
  }

  const inningLabel = compactText(mlbPregame.gameState?.inningLabel);
  const detailedStatus = compactText(mlbPregame.gameState?.detailedStatus);
  if (game.status === "inprogress" && (inningLabel || detailedStatus)) {
    signals.push(
      makeSignal(
        game.gameId,
        "game_state",
        "high",
        "Game is live",
        [inningLabel, detailedStatus].filter(Boolean).join(" · "),
        { scoreImpact: 1.5 },
      ),
    );
  }

  if (mlbPregame.scoringPlays.length > 0) {
    const latest = mlbPregame.scoringPlays[mlbPregame.scoringPlays.length - 1];
    signals.push(
      makeSignal(
        game.gameId,
        "scoring",
        game.status === "inprogress" ? "high" : "info",
        `${mlbPregame.scoringPlays.length} scoring play${mlbPregame.scoringPlays.length === 1 ? "" : "s"}`,
        latest.scoreLabel ? `${latest.scoreLabel}: ${latest.description}` : latest.description,
        {
          team: latest.battingTeam || undefined,
          scoreImpact: game.status === "inprogress" ? 1 : 0.25,
        },
      ),
    );
  }
}

function addTeamAndMarketSignals(
  signals: MlbGameplaySignal[],
  game: SignalGameContext,
  mlbPregame: MlbPregameInsight,
  leaders: BuildMlbGameplaySignalsInput["leaders"],
  userContext: SignalUserContext,
) {
  (["away", "home"] as const).forEach((side) => {
    const team = teamLabel(side, game);
    const context = mlbPregame.teamContexts[side];
    if (context?.record) {
      signals.push(
        makeSignal(game.gameId, "team", "info", `${team} team context`, context.record, {
          team,
          scoreImpact: 0.25,
        }),
      );
    }
  });

  const scoutLeader = leaders?.scouts;
  if (scoutLeader && Number(scoutLeader.scoutCount || 0) > 0) {
    signals.push(
      makeSignal(
        game.gameId,
        "market",
        "positive",
        `Scout attention: ${scoutLeader.name}`,
        `${scoutLeader.scoutCount} active scout${scoutLeader.scoutCount === 1 ? "" : "s"} on the top scout target in this game.`,
        { team: scoutLeader.team, scoreImpact: 0.5 },
      ),
    );
  }

  const ownedCount = userContext?.ownedPlayers?.length || 0;
  if (ownedCount > 0) {
    signals.push(
      makeSignal(
        game.gameId,
        "market",
        "positive",
        `${ownedCount} owned player${ownedCount === 1 ? "" : "s"} in game`,
        "Your portfolio has exposure in this matchup, so live fantasy movement can affect earnings.",
        { scoreImpact: 0.75 },
      ),
    );
  }
}

const SEVERITY_RANK: Record<MlbGameplaySignalSeverity, number> = {
  high: 0,
  positive: 1,
  warning: 2,
  info: 3,
};

export function buildMlbGameplaySignals({
  game,
  mlbPregame,
  leaders = {},
  userContext = null,
}: BuildMlbGameplaySignalsInput): MlbGameplaySignal[] {
  if (!mlbPregame) return [];

  const signals: MlbGameplaySignal[] = [];
  addGameStateSignals(signals, game, mlbPregame);
  addLineupSignals(signals, game, mlbPregame);
  addProbablePitcherSignals(signals, game, mlbPregame);
  addStatcastSignals(signals, game, mlbPregame);
  addTeamAndMarketSignals(signals, game, mlbPregame, leaders, userContext);

  const seen = new Set<string>();
  return signals
    .filter((signal) => {
      if (seen.has(signal.id)) return false;
      seen.add(signal.id);
      return true;
    })
    .sort((left, right) => {
      const severityDelta = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      if (severityDelta !== 0) return severityDelta;
      return (right.scoreImpact || 0) - (left.scoreImpact || 0);
    })
    .slice(0, 10);
}
