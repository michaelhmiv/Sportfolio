import type { AgentThreadTurnResult } from "./types";

const SMS_HARD_LIMIT = 640;

function truncateSms(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= SMS_HARD_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, SMS_HARD_LIMIT - 3).trim()}...`;
}

export function renderSmsThreadTurnResult(turn: AgentThreadTurnResult): string {
  const assistantMessages = turn.createdMessages.filter((message) => message.role === "assistant");
  const latestAssistantMessage = assistantMessages[assistantMessages.length - 1];
  const pendingBundle = turn.pendingActionBundle;
  const pendingClarification = turn.pendingClarification;

  if (pendingBundle) {
    const parts = [pendingBundle.summary];
    if (pendingBundle.warnings.length > 0) {
      parts.push(`Warning: ${pendingBundle.warnings[0]}`);
    }
    parts.push("Reply CONFIRM or CANCEL.");
    return truncateSms(parts.join(" "));
  }

  if (pendingClarification?.prompt) {
    return truncateSms(pendingClarification.prompt);
  }

  if (latestAssistantMessage?.contentText) {
    return truncateSms(latestAssistantMessage.contentText);
  }

  return "I processed that update, but I do not have a reply to send yet.";
}

export function renderUnknownSmsOnboardingReply(linkUrl: string): string {
  return truncateSms(
    `You can talk to me like your Sportfolio desk right here. I can walk through players, shares, scouts, boosts, and game angles. If you want account-specific help or in-game actions, link your account here: ${linkUrl}`,
  );
}

export function renderGuestSmsConciergeReply(input: {
  linkUrl: string;
  messageText: string;
  matchedTopicTitle?: string | null;
  matchedTopicNote?: string | null;
}): string {
  const normalizedMessage = input.messageText.trim();
  const opening =
    normalizedMessage.length > 0
      ? `I can talk that through with you.`
      : "You can talk to me like your Sportfolio desk right here.";
  const topicalNote =
    input.matchedTopicTitle && input.matchedTopicNote
      ? `${input.matchedTopicTitle}: ${input.matchedTopicNote}`
      : "I can break down player pools, scouts, boosts, watchlists, and account setup.";

  return truncateSms(
    `${opening} ${topicalNote} If you want account-specific reads or in-game actions, link your account here: ${input.linkUrl}`,
  );
}

export function renderSmsHelpReply(linkUrl: string, topicHint?: string | null): string {
  const hint = topicHint?.trim()
    ? `Start with: ${topicHint.trim()} `
    : "Text a normal question about shares, scouts, boosts, or watchlists. ";

  return truncateSms(
    `Sportfolio SMS help: ${hint}Use CONFIRM or CANCEL for pending actions. Need to create or link an account? ${linkUrl}`,
  );
}
