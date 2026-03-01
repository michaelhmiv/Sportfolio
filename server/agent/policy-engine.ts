import type { ScoutModelOutput } from "./output-schema";
import type { ScoutAgentContext, ScoutProposalAction } from "./types";

export function validateScoutPlanAgainstContext(
  output: ScoutModelOutput,
  context: ScoutAgentContext,
): {
  replyText: string;
  summary: string;
  observations: string[];
  warnings: string[];
  actions: ScoutProposalAction[];
} {
  const candidateMap = new Map(
    context.candidates.map((candidate) => [candidate.playerId, candidate]),
  );
  const seenPlayerIds = new Set<string>();
  const warnings = [...output.warnings];
  const actions: ScoutProposalAction[] = [];

  for (const action of output.actions) {
    if (seenPlayerIds.has(action.playerId)) {
      throw new Error(`Model returned duplicate actions for player ${action.playerId}`);
    }
    seenPlayerIds.add(action.playerId);

    const candidate = candidateMap.get(action.playerId);
    if (!candidate) {
      throw new Error(`Model referenced non-candidate player ${action.playerId}`);
    }

    if (action.actionType !== "scout_set_count") {
      throw new Error(`Unsupported action type ${action.actionType}`);
    }

    if (context.selectionWindow && action.targetCount > 0 && !candidate.hasGameInFocusWindow) {
      throw new Error(
        `Proposed scout plan includes ${candidate.name} outside the ${context.selectionWindow.label} slate`,
      );
    }

    if (action.targetCount === candidate.currentScoutCount) {
      continue;
    }

    const riskFlags: string[] = [];

    if (action.confidence < 0.45) {
      riskFlags.push("low_confidence");
    }

    if (candidate.injuryStatus) {
      riskFlags.push("injury_flag");
    }

    if (action.targetCount === context.maxScouts) {
      riskFlags.push("all_in_single_player");
    }

    actions.push({
      actionType: "scout_set_count",
      playerId: action.playerId,
      targetCount: action.targetCount,
      currentCount: candidate.currentScoutCount,
      reasoning: action.reasoning,
      confidence: action.confidence,
      evidence: {
        trend: action.evidence.trend ?? null,
        injury: action.evidence.injury ?? candidate.injuryStatus ?? null,
        upcomingGame: action.evidence.upcomingGame ?? candidate.upcomingGame ?? null,
        performanceNote: action.evidence.performanceNote ?? null,
      },
      riskFlags,
    });
  }

  const resultingCounts = new Map(
    context.assignments.map((assignment) => [assignment.playerId, assignment.scoutCount]),
  );

  for (const action of actions) {
    resultingCounts.set(action.playerId, action.targetCount);
  }

  let resultingTotal = 0;
  let positivePlayers = 0;

  for (const count of resultingCounts.values()) {
    if (count > 0) {
      positivePlayers += 1;
      resultingTotal += count;
    }
  }

  if (resultingTotal > context.maxScouts) {
    throw new Error(
      `Proposed scout plan exceeds capacity (${resultingTotal}/${context.maxScouts})`,
    );
  }

  if (positivePlayers <= 1 && resultingTotal > 0) {
    warnings.push("Plan leaves all active scouts concentrated on one player.");
    for (const action of actions) {
      if (!action.riskFlags.includes("concentration_risk")) {
        action.riskFlags.push("concentration_risk");
      }
    }
  }

  if (actions.length === 0) {
    warnings.push("No actionable scout changes were proposed.");
  }

  return {
    replyText: output.replyText || output.summary,
    summary: output.summary,
    observations: output.observations,
    warnings,
    actions,
  };
}
