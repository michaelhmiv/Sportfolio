export const NFL_SCORING = Object.freeze({
  passingYardsPerPoint: 25,
  passingTouchdown: 4,
  interception: -2,
  rushingYardsPerPoint: 10,
  rushingTouchdown: 6,
  reception: 1,
  receivingYardsPerPoint: 10,
  receivingTouchdown: 6,
  fumbleLost: -2,
  extraPointMade: 1,
  fieldGoal0To39: 3,
  fieldGoal40To49: 4,
  fieldGoal50Plus: 5,
  fallbackFieldGoalMade: 3,
});

export interface NflFantasyStatLine {
  passingYards?: number | null;
  passingTouchdowns?: number | null;
  interceptions?: number | null;
  rushingYards?: number | null;
  rushingTouchdowns?: number | null;
  receptions?: number | null;
  receivingYards?: number | null;
  receivingTouchdowns?: number | null;
  fumblesLost?: number | null;
  extraPointsMade?: number | null;
  fieldGoalsMade?: number | null;
  fieldGoalDistances?: number[] | null;
}

const numeric = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function fieldGoalFantasyPoints(distance: number): number {
  if (distance >= 50) return NFL_SCORING.fieldGoal50Plus;
  if (distance >= 40) return NFL_SCORING.fieldGoal40To49;
  return NFL_SCORING.fieldGoal0To39;
}

export function calculateNflFantasyPoints(stats: NflFantasyStatLine): number {
  let points = 0;
  points += numeric(stats.passingYards) / NFL_SCORING.passingYardsPerPoint;
  points += numeric(stats.passingTouchdowns) * NFL_SCORING.passingTouchdown;
  points += numeric(stats.interceptions) * NFL_SCORING.interception;
  points += numeric(stats.rushingYards) / NFL_SCORING.rushingYardsPerPoint;
  points += numeric(stats.rushingTouchdowns) * NFL_SCORING.rushingTouchdown;
  points += numeric(stats.receptions) * NFL_SCORING.reception;
  points += numeric(stats.receivingYards) / NFL_SCORING.receivingYardsPerPoint;
  points += numeric(stats.receivingTouchdowns) * NFL_SCORING.receivingTouchdown;
  points += numeric(stats.fumblesLost) * NFL_SCORING.fumbleLost;
  points += numeric(stats.extraPointsMade) * NFL_SCORING.extraPointMade;

  const made = Math.max(0, Math.trunc(numeric(stats.fieldGoalsMade)));
  const distances = Array.isArray(stats.fieldGoalDistances)
    ? stats.fieldGoalDistances.filter((value) => Number.isFinite(Number(value))).map(Number)
    : [];
  const distanceCount = Math.min(made, distances.length);
  for (let index = 0; index < distanceCount; index++) {
    points += fieldGoalFantasyPoints(distances[index]);
  }
  points += (made - distanceCount) * NFL_SCORING.fallbackFieldGoalMade;

  return Math.round(points * 100) / 100;
}
