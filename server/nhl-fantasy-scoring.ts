/** DraftKings NHL Classic scoring. Inputs deliberately distinguish absent evidence from zero. */
export type NhlSkaterScoringInput = {
  kind: "skater";
  goals?: number | null;
  assists?: number | null;
  shotsOnGoal?: number | null;
  blockedShots?: number | null;
  shortHandedPoints?: number | null;
  shootoutGoals?: number | null;
};
export type NhlGoalieScoringInput = {
  kind: "goalie";
  decision?: string | null;
  saves?: number | null;
  goalsAgainst?: number | null;
  shutout?: boolean | null;
};
export type NhlScoringInput = NhlSkaterScoringInput | NhlGoalieScoringInput;
const count = (value: number | null | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(Number(value))) : 0;
const round = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;

export function calculateNhlFantasyPoints(input: NhlScoringInput) {
  if (input.kind === "skater") {
    const goals = count(input.goals);
    const assists = count(input.assists);
    const shotsOnGoal = count(input.shotsOnGoal);
    const blockedShots = count(input.blockedShots);
    const shortHandedPoints = count(input.shortHandedPoints);
    const shootoutGoals = count(input.shootoutGoals);
    const totalPoints = goals + assists;
    const breakdown = {
      goals: goals * 8.5,
      assists: assists * 5,
      shotsOnGoal: shotsOnGoal * 1.5,
      blockedShots: blockedShots * 1.3,
      shortHandedPoints: shortHandedPoints * 2,
      shootoutGoals: shootoutGoals * 1.5,
      hatTrickBonus: goals >= 3 ? 3 : 0,
      threePointBonus: totalPoints >= 3 ? 3 : 0,
    };
    return {
      points: round(Object.values(breakdown).reduce((sum, value) => sum + value, 0)),
      breakdown,
    };
  }
  const saves = count(input.saves);
  const goalsAgainst = count(input.goalsAgainst);
  const decision = String(input.decision || "").toUpperCase();
  const isWin = decision === "W" || decision === "WIN";
  const isOvertimeLoss = !isWin && ["OTL", "OT", "SOL", "SO"].includes(decision);
  // NHL shutouts require explicit, reliable provider confirmation. A 0 GA field alone is insufficient (relief appearances exist).
  const breakdown = {
    win: isWin ? 6 : 0,
    saves: saves * 0.7,
    goalsAllowed: goalsAgainst * -3.5,
    shutoutBonus: input.shutout === true ? 4 : 0,
    overtimeLossBonus: isOvertimeLoss ? 2 : 0,
    thirtyFiveSaveBonus: saves >= 35 ? 3 : 0,
  };
  return {
    points: round(Object.values(breakdown).reduce((sum, value) => sum + value, 0)),
    breakdown,
  };
}
