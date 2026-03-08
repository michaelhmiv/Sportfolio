import { parsePendingClarification } from "./clarification";
import type {
  AgentAction,
  AgentActionBundleStatus,
  AgentPendingClarification,
  AgentWorkflowStepStatus,
  AgentWorkflowStepView,
} from "./types";

type PersistedWorkflowStep = {
  id: string;
  title: string;
  status: AgentWorkflowStepStatus;
  action: AgentAction | null;
  clarificationPrompt?: string | null;
};

type PersistedWorkflowPayload = {
  kind: "workflow_bundle";
  version: 1;
  workflowType: "single_action" | "multi_action" | "clarification";
  steps: PersistedWorkflowStep[];
  pendingClarification: AgentPendingClarification | null;
};

function normalizeStepStatusForBundleStatus(
  stepStatus: AgentWorkflowStepStatus,
  bundleStatus: AgentActionBundleStatus,
): AgentWorkflowStepStatus {
  if (bundleStatus === "applied") {
    return "completed";
  }

  if (bundleStatus === "failed") {
    return stepStatus === "completed" ? "completed" : "failed";
  }

  if (bundleStatus === "rejected" || bundleStatus === "expired") {
    return stepStatus === "completed" ? "completed" : "cancelled";
  }

  return stepStatus;
}

function describeAction(action: AgentAction): string {
  switch (action.actionType) {
    case "pool_buy":
      return `Buy ${action.playerName || action.playerId}`;
    case "pool_sell":
      return `Sell ${action.playerName || action.playerId}`;
    case "pool_add_liquidity":
      return `Add liquidity to ${action.playerName || action.playerId}`;
    case "pool_add_liquidity_optimal":
      return `Add optimal liquidity to ${action.playerName || action.playerId}`;
    case "pool_zap_add_shares":
      return `Zap shares into ${action.playerName || action.playerId}`;
    case "pool_zap_add_sb":
      return `Zap cash into ${action.playerName || action.playerId}`;
    case "pool_remove_liquidity":
      return `Remove liquidity from ${action.playerName || action.playerId}`;
    case "holdings_stack_shares":
      return `Stack Shares for ${action.playerName || action.playerId}`;
    case "daily_boost_assign":
      return `Assign ${action.playerName || action.playerId} to ${action.slotTier}x boost`;
    case "daily_boost_remove":
      return `Remove ${action.playerName || action.playerId} from ${action.slotTier}x boost`;
    case "watchlist_add_player":
      return `Add ${action.playerName || action.playerId} to ${action.watchlistName || "watchlist"}`;
    case "watchlist_remove_player":
      return `Remove ${action.playerName || action.playerId} from watchlists`;
    case "community_boost_create":
      return `Create community boost for ${action.playerName || action.playerId}`;
    case "vesting_claim":
      return `Claim ${action.claimableShares} vested share${action.claimableShares === 1 ? "" : "s"}`;
    case "scout_set_count":
    default:
      return `Update scouts for ${action.playerName || action.playerId}`;
  }
}

function parseWorkflowPayload(rawPayload: unknown): PersistedWorkflowPayload | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  const candidate = rawPayload as Record<string, unknown>;
  if (candidate.kind !== "workflow_bundle") {
    return null;
  }

  const workflowType =
    candidate.workflowType === "single_action" ||
    candidate.workflowType === "multi_action" ||
    candidate.workflowType === "clarification"
      ? candidate.workflowType
      : "clarification";

  const pendingClarification = parsePendingClarification(candidate.pendingClarification);
  const steps = Array.isArray(candidate.steps)
    ? candidate.steps
        .filter((entry): entry is Record<string, unknown> =>
          Boolean(entry && typeof entry === "object"),
        )
        .map((entry, index) => {
          const stepStatus =
            entry.status === "ready" ||
            entry.status === "needs_clarification" ||
            entry.status === "blocked" ||
            entry.status === "completed" ||
            entry.status === "failed" ||
            entry.status === "cancelled"
              ? entry.status
              : "blocked";

          const title =
            typeof entry.title === "string" && entry.title.trim()
              ? entry.title.trim()
              : `Step ${index + 1}`;

          return {
            id:
              typeof entry.id === "string" && entry.id.trim()
                ? entry.id.trim()
                : `step-${index + 1}`,
            title,
            status: stepStatus,
            action:
              entry.action && typeof entry.action === "object"
                ? (entry.action as AgentAction)
                : null,
            clarificationPrompt:
              typeof entry.clarificationPrompt === "string" ? entry.clarificationPrompt : null,
          } satisfies PersistedWorkflowStep;
        })
    : [];

  return {
    kind: "workflow_bundle",
    version: 1,
    workflowType,
    steps,
    pendingClarification,
  };
}

function buildLegacySteps(
  actions: AgentAction[],
  bundleStatus: AgentActionBundleStatus,
): AgentWorkflowStepView[] {
  const defaultStatus: AgentWorkflowStepStatus =
    bundleStatus === "applied"
      ? "completed"
      : bundleStatus === "failed"
        ? "failed"
        : bundleStatus === "rejected" || bundleStatus === "expired"
          ? "cancelled"
          : "ready";

  return actions.map((action, index) => ({
    id: `step-${index + 1}`,
    title: describeAction(action),
    status: defaultStatus,
    action,
    clarificationPrompt: null,
  }));
}

export function buildWorkflowPayload(input: {
  summary: string | null;
  actions: AgentAction[];
  pendingClarification?: AgentPendingClarification | null;
}): PersistedWorkflowPayload {
  const pendingClarification = input.pendingClarification || null;
  const workflowType = pendingClarification
    ? "clarification"
    : input.actions.length > 1
      ? "multi_action"
      : "single_action";

  let steps: PersistedWorkflowStep[] = [];
  if (input.actions.length > 0) {
    steps = input.actions.map((action, index) => ({
      id: `step-${index + 1}`,
      title: describeAction(action),
      status: "ready",
      action,
      clarificationPrompt: null,
    }));
  } else if (pendingClarification) {
    const previewSteps =
      pendingClarification.workflowPreviewSteps &&
      pendingClarification.workflowPreviewSteps.length > 0
        ? pendingClarification.workflowPreviewSteps
        : [pendingClarification.workflowTitle || input.summary || "Complete the pending plan"];

    steps = previewSteps.map((title, index) => ({
      id: `step-${index + 1}`,
      title,
      status: index === 0 ? "needs_clarification" : "blocked",
      action: null,
      clarificationPrompt: index === 0 ? pendingClarification.prompt : null,
    }));
  }

  return {
    kind: "workflow_bundle",
    version: 1,
    workflowType,
    steps,
    pendingClarification,
  };
}

export function getBundleActions(rawPayload: unknown): AgentAction[] {
  if (Array.isArray(rawPayload)) {
    return rawPayload.filter((entry): entry is AgentAction =>
      Boolean(entry && typeof entry === "object"),
    );
  }

  const workflowPayload = parseWorkflowPayload(rawPayload);
  if (!workflowPayload) {
    return [];
  }

  return workflowPayload.steps
    .map((step) => step.action)
    .filter((entry): entry is AgentAction => Boolean(entry));
}

export function getBundlePendingClarification(
  rawPayload: unknown,
): AgentPendingClarification | null {
  if (Array.isArray(rawPayload)) {
    return null;
  }

  const workflowPayload = parseWorkflowPayload(rawPayload);
  if (!workflowPayload) {
    return parsePendingClarification(rawPayload);
  }

  return workflowPayload.pendingClarification;
}

export function getBundleWorkflowView(input: {
  rawPayload: unknown;
  bundleStatus: AgentActionBundleStatus;
}): {
  workflowType: "single_action" | "multi_action" | "clarification";
  steps: AgentWorkflowStepView[];
  actions: AgentAction[];
  pendingClarification: AgentPendingClarification | null;
} {
  const workflowPayload = parseWorkflowPayload(input.rawPayload);
  if (!workflowPayload) {
    const actions = getBundleActions(input.rawPayload);
    return {
      workflowType: actions.length > 1 ? "multi_action" : "single_action",
      steps: buildLegacySteps(actions, input.bundleStatus),
      actions,
      pendingClarification: null,
    };
  }

  const steps = workflowPayload.steps.map((step) => ({
    ...step,
    status: normalizeStepStatusForBundleStatus(step.status, input.bundleStatus),
  }));
  const actions = steps
    .map((step) => step.action)
    .filter((entry): entry is AgentAction => Boolean(entry));

  return {
    workflowType: workflowPayload.workflowType,
    steps,
    actions,
    pendingClarification: workflowPayload.pendingClarification,
  };
}
