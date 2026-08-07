const DENIED_PUBLIC_TOOL_NAMES = [
  "review_idle_cash",
  "review_news_impact",
  "review_portfolio_cleanup",
  "review_setup",
  "list_schedule_templates",
  "list_schedules",
  "upsert_schedule",
  "delete_schedule",
  "get_news_digest",
  "get_news_unread_count",
  "mark_news_read",
] as const;

const DENIED_PUBLIC_TOOL_NAME_SET = new Set<string>(DENIED_PUBLIC_TOOL_NAMES);
const DENIED_PUBLIC_PROMPT_NAME_SET = new Set(["review_setup", "review_idle_cash"]);

export function isApprovedPublicToolName(name: string): boolean {
  return !DENIED_PUBLIC_TOOL_NAME_SET.has(name);
}

export function isApprovedPublicPromptName(name: string): boolean {
  return !DENIED_PUBLIC_PROMPT_NAME_SET.has(name);
}

export function getDeniedPublicToolNames(): string[] {
  return [...DENIED_PUBLIC_TOOL_NAMES];
}
