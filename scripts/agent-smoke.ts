import { loadScoutAgentContext } from "../server/agent/context-loader";
import { planDirectAgentOperation } from "../server/agent/operations-planner";
import {
  buildHostedWebResearchQueries,
  isHostedWebResearchAvailable,
  planHostedWebResearch,
  shouldUseHostedWebResearch,
} from "../server/agent/research";
import { getAgentCapabilities, getScoutAgentProfile } from "../server/agent/service";

type SmokeSummary = {
  label: string;
  message: string;
  domain: string | null;
  outcome:
    | "staged_plan"
    | "blocked_clarification"
    | "research_only"
    | "blocked_unavailable"
    | "advisory_only";
  summary: string | null;
  actionTypes: string[];
  hasClarification: boolean;
  warningCount: number;
  replyPreview: string | null;
};

function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return null;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    return null;
  }

  return value;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function trimPreview(value: string | null | undefined, maxLength = 160): string | null {
  const text = value?.trim();
  if (!text) {
    return null;
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function classifySummary(input: {
  actions: Array<{ actionType: string }>;
  pendingClarification?: unknown;
  citations?: Array<unknown> | null;
  summary?: string | null;
  replyText?: string | null;
}): SmokeSummary["outcome"] {
  if (input.pendingClarification) {
    return "blocked_clarification";
  }

  if (input.actions.length > 0) {
    return "staged_plan";
  }

  if ((input.citations?.length || 0) > 0) {
    return "research_only";
  }

  const lowerSignal = `${input.summary || ""} ${input.replyText || ""}`.toLowerCase();
  if (
    /\b(?:i do not|i don't|cannot|can't|could not|couldn't|did not|there are no|not available|not supported)\b/.test(
      lowerSignal,
    )
  ) {
    return "blocked_unavailable";
  }

  return "advisory_only";
}

function summarizePlan(
  label: string,
  message: string,
  result: Awaited<ReturnType<typeof planDirectAgentOperation>>,
): SmokeSummary {
  return {
    label,
    message,
    domain: result?.domain || null,
    outcome: classifySummary({
      actions: result?.actions || [],
      pendingClarification: result?.pendingClarification,
      citations: result?.citations,
      summary: result?.summary,
      replyText: result?.replyText,
    }),
    summary: result?.summary || null,
    actionTypes: (result?.actions || []).map((action) => action.actionType),
    hasClarification: Boolean(result?.pendingClarification),
    warningCount: result?.warnings.length || 0,
    replyPreview: trimPreview(result?.replyText),
  };
}

async function main() {
  const userId = getArg("--user") || process.env.AGENT_SMOKE_USER_ID || null;
  if (!userId) {
    throw new Error(
      "Missing user id. Run with --user <userId> or set AGENT_SMOKE_USER_ID in the environment.",
    );
  }

  const includeActionPlans = hasFlag("--include-action-plans");
  const includeLiveResearch = hasFlag("--live-research");
  const requestedPlayerName = getArg("--player");

  const profileView = await getScoutAgentProfile(userId);
  const capabilities = await getAgentCapabilities(userId);
  const context = await loadScoutAgentContext(userId, profileView.profile, {
    chatRequest: "review my setup",
  });
  const samplePlayerName =
    requestedPlayerName ||
    context.recommendedTargets[0]?.name ||
    context.candidates[0]?.name ||
    null;

  const advisoryPrompts = [
    { label: "broad_review", message: "review my setup" },
    { label: "portfolio_cleanup", message: "clean up my portfolio" },
    { label: "idle_balance", message: "what should i do with my idle balance?" },
    { label: "community_scan", message: "who should get my community boost today?" },
    { label: "capability_guide", message: "what can you do?" },
  ];
  const actionPrompts =
    samplePlayerName && includeActionPlans
      ? [
          { label: "pool_buy", message: `buy $25 of ${samplePlayerName}` },
          { label: "watchlist_add", message: `add ${samplePlayerName} to my watchlist` },
          { label: "boost_assign", message: `put ${samplePlayerName} in my 2x boost slot today` },
          {
            label: "community_create",
            message: `create a community boost for ${samplePlayerName} today`,
          },
          { label: "vesting_claim", message: "claim my vesting shares" },
        ]
      : [];

  const planSummaries: SmokeSummary[] = [];
  for (const prompt of [...advisoryPrompts, ...actionPrompts]) {
    const result = await planDirectAgentOperation({
      userId,
      message: prompt.message,
      profile: profileView.profile,
    });
    planSummaries.push(summarizePlan(prompt.label, prompt.message, result));
  }

  const researchMessage = `research the latest injury news on ${samplePlayerName || "my top player"}`;
  const researchShouldRun = shouldUseHostedWebResearch(researchMessage);
  const researchQueries = buildHostedWebResearchQueries(researchMessage, profileView.profile);
  const liveResearchSummary =
    includeLiveResearch && isHostedWebResearchAvailable() && researchShouldRun
      ? await planHostedWebResearch({
          message: researchMessage,
          profile: profileView.profile,
        })
      : null;

  const output = {
    generatedAt: new Date().toISOString(),
    userId,
    includeActionPlans,
    includeLiveResearch,
    capabilities,
    profile: {
      providerMode: profileView.profile.providerMode,
      enabled: profileView.profile.enabled,
      defaultSport: profileView.profile.defaultSport,
      canUseWebResearch: profileView.capabilities.canUseWebResearch,
    },
    contextSnapshot: {
      recommendedTargetCount: context.recommendedTargets.length,
      candidateCount: context.candidates.length,
      samplePlayerName,
      operatorOverview: {
        availableBalance: context.operatorOverview.availableBalance,
        portfolioPlayerCount: context.operatorOverview.portfolioPlayerCount,
        activeDailyBoostSlots: context.operatorOverview.activeDailyBoostSlots,
        openDailyBoostSlots: context.operatorOverview.openDailyBoostSlots,
        claimableVestingShares: context.operatorOverview.claimableVestingShares,
        nextBestLevers: context.operatorOverview.nextBestLevers,
      },
    },
    plans: planSummaries,
    research: {
      available: isHostedWebResearchAvailable(),
      shouldUse: researchShouldRun,
      message: researchMessage,
      queries: researchQueries,
      liveSummary: liveResearchSummary
        ? {
            outcome: classifySummary({
              actions: liveResearchSummary.actions,
              pendingClarification: liveResearchSummary.pendingClarification,
              citations: liveResearchSummary.citations,
              summary: liveResearchSummary.summary,
              replyText: liveResearchSummary.replyText,
            }),
            summary: liveResearchSummary.summary,
            citationCount: liveResearchSummary.citations?.length || 0,
            replyPreview: trimPreview(liveResearchSummary.replyText),
          }
        : null,
    },
    notes: [
      "This script exercises internal agent modules directly and does not execute any confirmation-gated economic mutation.",
      includeActionPlans
        ? "Action-plan checks are included; some quote paths may touch read-heavy market helpers."
        : "Action-plan checks are disabled by default. Pass --include-action-plans to include staged mutation previews.",
      includeLiveResearch
        ? "Live hosted-research execution was requested."
        : "Live hosted-research execution is disabled by default. Pass --live-research to attempt it when Brave is configured.",
    ],
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agent-smoke] ${message}`);
  process.exitCode = 1;
});
