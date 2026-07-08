import type { DailyGame, Player } from "@shared/schema";
import type { MlbPregameInsight } from "./mlb-pregame-insights";
import type { MlbGameplaySignal } from "./mlb-gameplay-signals";

export type MlbPlayerContextLineup = {
  lineupsPosted: boolean;
  slot: number | null;
  position: string | null;
  label: string | null;
};

export type MlbPlayerContextPitcher = {
  name: string | null;
  note: string | null;
  summary: string | null;
};

export type MlbPlayerContextSpotlight = {
  summary: string;
  expectedWoba: number | null;
  expectedSlugging: number | null;
  expectedBattingAverage: number | null;
};

export type MlbPlayerContextPayload = {
  player: {
    id: string;
    name: string;
    team: string;
    position: string | null;
  };
  game: {
    gameId: string;
    opponentLabel: string;
    startTime: string;
    status: string;
    venue: string | null;
    isHome: boolean;
    scoreLabel: string | null;
  } | null;
  matchupSummary: string | null;
  weatherSummary: string | null;
  lineup: MlbPlayerContextLineup | null;
  opposingProbablePitcher: MlbPlayerContextPitcher | null;
  hitterSpotlight: MlbPlayerContextSpotlight | null;
  playerSignals: MlbGameplaySignal[];
};

type BuildMlbPlayerContextInput = {
  player: Pick<Player, "id" | "firstName" | "lastName" | "team" | "position">;
  game: Pick<
    DailyGame,
    | "gameId"
    | "homeTeam"
    | "awayTeam"
    | "startTime"
    | "status"
    | "venue"
    | "homeScore"
    | "awayScore"
  > | null;
  mlbPregame: MlbPregameInsight | null;
  signals?: MlbGameplaySignal[] | null;
};

function normalizeName(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function playerName(player: Pick<Player, "firstName" | "lastName">): string {
  return `${player.firstName} ${player.lastName}`.trim();
}

function sideForPlayerTeam(
  game: Pick<DailyGame, "homeTeam" | "awayTeam">,
  team: string,
): "home" | "away" | null {
  const normalizedTeam = String(team || "")
    .trim()
    .toUpperCase();
  if (
    String(game.homeTeam || "")
      .trim()
      .toUpperCase() === normalizedTeam
  )
    return "home";
  if (
    String(game.awayTeam || "")
      .trim()
      .toUpperCase() === normalizedTeam
  )
    return "away";
  return null;
}

function formatScoreLabel(
  game: Pick<DailyGame, "homeTeam" | "awayTeam" | "homeScore" | "awayScore">,
): string | null {
  if (game.homeScore == null || game.awayScore == null) return null;
  return `${game.awayTeam} ${game.awayScore}, ${game.homeTeam} ${game.homeScore}`;
}

function findLineupEntry(input: BuildMlbPlayerContextInput, side: "home" | "away") {
  const targetName = normalizeName(playerName(input.player));
  const entries = input.mlbPregame?.startingLineups[side] || [];
  return (
    entries.find((entry) => entry.playerId && entry.playerId === input.player.id) ||
    entries.find((entry) => normalizeName(entry.name) === targetName) ||
    null
  );
}

function findHitterSpotlight(input: BuildMlbPlayerContextInput, side: "home" | "away") {
  const targetName = normalizeName(playerName(input.player));
  const spotlights = input.mlbPregame?.hitterSpotlights[side] || [];
  return spotlights.find((spotlight) => normalizeName(spotlight.name) === targetName) || null;
}

function filterPlayerSignals(input: BuildMlbPlayerContextInput): MlbGameplaySignal[] {
  const playerNameKey = normalizeName(playerName(input.player));
  const playerTeam = String(input.player.team || "")
    .trim()
    .toUpperCase();

  return (input.signals || [])
    .filter((signal) => {
      if (signal.playerId && signal.playerId === input.player.id) return true;
      const signalTeam = String(signal.team || "")
        .trim()
        .toUpperCase();
      const sameTeam = !signalTeam || signalTeam === playerTeam;
      const labelMatches = normalizeName(signal.label).includes(playerNameKey);
      const detailMatches = normalizeName(signal.detail).includes(playerNameKey);
      return sameTeam && (labelMatches || detailMatches);
    })
    .slice(0, 4);
}

export function buildMlbPlayerContextPayload(
  input: BuildMlbPlayerContextInput,
): MlbPlayerContextPayload {
  const name = playerName(input.player);
  if (!input.game) {
    return {
      player: {
        id: input.player.id,
        name,
        team: input.player.team,
        position: input.player.position || null,
      },
      game: null,
      matchupSummary: null,
      weatherSummary: null,
      lineup: null,
      opposingProbablePitcher: null,
      hitterSpotlight: null,
      playerSignals: [],
    };
  }

  const side = sideForPlayerTeam(input.game, input.player.team);
  const opponentSide = side === "home" ? "away" : side === "away" ? "home" : null;
  const opponentTeam =
    side === "home" ? input.game.awayTeam : side === "away" ? input.game.homeTeam : null;
  const lineupEntry = side ? findLineupEntry(input, side) : null;
  const spotlight = side ? findHitterSpotlight(input, side) : null;
  const opposingPitcher = opponentSide
    ? input.mlbPregame?.probablePitchers[opponentSide] || null
    : null;
  const opposingPitcherStats = opponentSide
    ? input.mlbPregame?.probablePitcherStats[opponentSide] || null
    : null;
  const isHome = side === "home";

  return {
    player: {
      id: input.player.id,
      name,
      team: input.player.team,
      position: input.player.position || null,
    },
    game: {
      gameId: input.game.gameId,
      opponentLabel: opponentTeam ? `${isHome ? "vs" : "@"} ${opponentTeam}` : "Upcoming game",
      startTime: input.game.startTime.toISOString(),
      status: input.game.status,
      venue: input.game.venue || input.mlbPregame?.venue || null,
      isHome,
      scoreLabel: formatScoreLabel(input.game),
    },
    matchupSummary: input.mlbPregame?.matchupSummary || null,
    weatherSummary:
      input.mlbPregame?.weatherSummary || input.mlbPregame?.gameState?.weatherSummary || null,
    lineup: {
      lineupsPosted: Boolean(input.mlbPregame?.lineupsPosted),
      slot: lineupEntry?.slot ?? null,
      position: lineupEntry?.position || null,
      label: lineupEntry
        ? `Batting ${lineupEntry.slot}${lineupEntry.position ? ` · ${lineupEntry.position}` : ""}`
        : input.mlbPregame?.lineupsPosted
          ? "Not in posted lineup"
          : "Lineup pending",
    },
    opposingProbablePitcher: opposingPitcher
      ? {
          name: opposingPitcher.name,
          note: opposingPitcher.note || null,
          summary: opposingPitcherStats?.summary || null,
        }
      : null,
    hitterSpotlight: spotlight
      ? {
          summary: spotlight.summary,
          expectedWoba: spotlight.expectedWoba,
          expectedSlugging: spotlight.expectedSlugging,
          expectedBattingAverage: spotlight.expectedBattingAverage,
        }
      : null,
    playerSignals: filterPlayerSignals(input),
  };
}
