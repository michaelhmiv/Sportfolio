import type { SportsAdapter } from "./adapter-registry";
import type { Athlete, Game, LiveState, ProviderMetadata, Team } from "./contracts";
import { createProviderMetadata, reconcileAndSortGames } from "./semantics";
import { espnNfl, type EspnNflGame } from "../nfl/espn-client";
import { buildNflIdentityMaps, createNflPlayerId } from "../nfl/identity";
import { nflverse } from "../nfl/nflverse";

const metadata = (provider: string, now: Date, ttl: number): ProviderMetadata =>
  createProviderMetadata({ provider, fetchedAt: now, staleAfterSeconds: ttl });

const canonicalTeamId = (abbreviation: string) => `nfl_team_${abbreviation.toUpperCase()}`;
const canonicalGameId = (espnId: string) => `nfl_game_${espnId}`;

function game(value: EspnNflGame, now: Date): Game {
  return {
    id: canonicalGameId(value.espnId),
    sport: "nfl",
    startsAt: value.startsAt.toISOString(),
    status:
      value.status === "inprogress"
        ? "in_progress"
        : value.status === "completed"
          ? "final"
          : value.status,
    homeTeamId: canonicalTeamId(value.homeTeam),
    awayTeamId: canonicalTeamId(value.awayTeam),
    seasonId: String(value.season),
    sourceStatus: value.sourceStatus,
    statusSource: "provider",
    statusConfidence: "authoritative",
    statusReason: null,
    eventOrderKey: `${value.startsAt.toISOString()}|${value.espnId}`,
    provider: metadata("espn-nfl", now, value.status === "inprogress" ? 300 : 3600),
  };
}

let playerCache:
  | { expiresAt: number; byEspnId: ReturnType<typeof buildNflIdentityMaps>["byEspnId"]; athletes: Athlete[] }
  | undefined;

async function loadAthletes(now: Date): Promise<{ athletes: Athlete[]; byEspnId: Map<string, any> }> {
  if (playerCache && playerCache.expiresAt > now.getTime()) return playerCache;
  const identities = await nflverse.getPlayers();
  const maps = buildNflIdentityMaps(identities);
  const athletes = identities
    .filter((player) => ["QB", "RB", "WR", "TE", "K"].includes(String(player.position || "")))
    .map(
      (player): Athlete => ({
        id: createNflPlayerId(player.gsisId),
        sport: "nfl",
        name: player.displayName,
        teamId: player.team ? canonicalTeamId(player.team) : null,
        position: player.position,
        active: player.active,
        provider: metadata("nflverse", now, 21_600),
      }),
    );
  playerCache = { expiresAt: now.getTime() + 21_600_000, byEspnId: maps.byEspnId, athletes };
  return playerCache;
}

export function createNflAdapter(deps: { now?: () => Date } = {}): SportsAdapter {
  const nowFn = deps.now || (() => new Date());
  return {
    sport: "nfl",
    async searchAthletes(query) {
      const now = nowFn();
      const { athletes } = await loadAthletes(now);
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      return athletes
        .filter(
          (athlete) =>
            athlete.name.toLowerCase().includes(needle) ||
            String(athlete.position || "").toLowerCase() === needle,
        )
        .slice(0, 50);
    },
    async getAthlete(id) {
      const { athletes } = await loadAthletes(nowFn());
      return athletes.find((athlete) => athlete.id === id) || null;
    },
    async getTeams() {
      const now = nowFn();
      return (await espnNfl.getTeams()).map(
        (value): Team => ({
          id: canonicalTeamId(value.abbreviation),
          sport: "nfl",
          name: value.name,
          abbreviation: value.abbreviation,
          provider: metadata("espn-nfl", now, 86_400),
        }),
      );
    },
    async getSchedule(from, to) {
      const now = nowFn();
      const format = (date: Date) =>
        `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
      const values = await espnNfl.getGames({ dates: `${format(from)}-${format(to)}`, limit: 200 });
      return reconcileAndSortGames(
        values
          .filter((value) => value.startsAt >= from && value.startsAt <= to)
          .map((value) => game(value, now)),
      );
    },
    async getLiveState(id) {
      const providerId = id.replace(/^nfl_game_/, "");
      if (!/^\d+$/.test(providerId)) return null;
      const now = nowFn();
      const values = await espnNfl.getGames({ limit: 200 });
      const value = values.find((candidate) => candidate.espnId === providerId);
      if (!value) return null;
      return {
        gameId: id,
        status:
          value.status === "inprogress"
            ? "in_progress"
            : value.status === "completed"
              ? "final"
              : value.status,
        clock: value.clock,
        period: value.period == null ? null : String(value.period),
        summary: value.period == null ? null : `Q${value.period}`,
        sourceStatus: value.sourceStatus,
        statusSource: "provider",
        statusConfidence: "authoritative",
        statusReason: null,
        phase: {
          kind: "period",
          number: value.period,
          label: value.period == null ? null : `Quarter ${value.period}`,
        },
        progress: value.clock
          ? { current: null, total: null, remaining: null, unit: "second" }
          : null,
        provider: metadata("espn-nfl", now, 300),
      } satisfies LiveState;
    },
  };
}
