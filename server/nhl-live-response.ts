type Game = { gameId: string; status: string; homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null };
type Stat = { playerId: string; homeAway: string | null; fantasyPoints: string | number | null; statsJson: any };
type Player = { id: string; firstName: string; lastName: string; team: string | null };
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const nullableNumber = (value: unknown) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);

/** Canonical persisted-only NHL live response adapter. Game side is from stat.homeAway, never current roster. */
export function buildNhlLiveResponse(game: Game, stats: Stat[], players: Map<string, Player>) {
  const mapped = stats.map((stat) => {
    const values = stat.statsJson || {};
    const side = stat.homeAway === "home" ? "home" : "away";
    const player = players.get(stat.playerId);
    return {
      id: stat.playerId.replace(/^nhl_/, ""), playerId: stat.playerId,
      name: player ? `${player.firstName} ${player.lastName}` : "Unknown player",
      team: side === "home" ? game.homeTeam : game.awayTeam,
      position: values.position || null, goals: number(values.goals), assists: number(values.assists), points: number(values.points),
      shotsOnGoal: number(values.shotsOnGoal), hits: number(values.hits), blockedShots: number(values.blockedShots),
      saves: nullableNumber(values.saves), goalsAgainst: nullableNumber(values.goalsAgainst), timeOnIce: values.timeOnIce || null,
      decision: values.decision || null, fantasyPoints: number(stat.fantasyPoints),
    };
  });
  const homePlayers = mapped.filter((player) => player.team === game.homeTeam);
  const awayPlayers = mapped.filter((player) => player.team === game.awayTeam);
  const top = (rows: typeof mapped) => [...rows].sort((a, b) => b.fantasyPoints - a.fantasyPoints).slice(0, 3)
    .map(({ playerId, name, team, goals, assists, points, saves, fantasyPoints }) => ({ playerId, name, team, goals, assists, points, saves, fantasyPoints }));
  const state = (stats.find((stat) => (stat.statsJson as any)?.liveState)?.statsJson as any)?.liveState || {};
  return { gameId: game.gameId, sport: "NHL", status: game.status, period: nullableNumber(state.period), periodType: state.periodType || null, clock: state.clock || null,
    homeTeam: game.homeTeam, homeScore: game.homeScore, awayTeam: game.awayTeam, awayScore: game.awayScore,
    homePlayers, awayPlayers, homeTopPerformers: top(homePlayers), awayTopPerformers: top(awayPlayers), message: mapped.length ? undefined : "No box score available yet" };
}
