const DENIED_PUBLIC_TOOL_NAMES = [
  "get_agent_capabilities",
  "get_agent_profile",
  "update_agent_profile",
  "clear_agent_byok",
  "save_agent_byok",
  "create_agent_thread",
  "list_agent_threads",
  "list_thread_messages",
  "list_thread_research_sources",
  "get_thread_state",
  "send_agent_message",
  "run_hosted_research",
  "review_idle_cash",
  "review_news_impact",
  "review_portfolio_cleanup",
  "review_setup",
  "list_schedule_templates",
  "list_schedules",
  "upsert_schedule",
  "delete_schedule",
  "get_sms_settings",
  "update_sms_settings",
  "start_sms_link",
  "complete_sms_link",
  "get_news_digest",
  "get_news_unread_count",
  "mark_news_read",
] as const;

const DENIED_PUBLIC_TOOL_NAME_SET = new Set<string>(DENIED_PUBLIC_TOOL_NAMES);
const DENIED_PUBLIC_PROMPT_NAME_SET = new Set(["review_setup", "review_idle_cash"]);

export function isApprovedPublicToolName(name: string): boolean {
  return !name.startsWith("mlb_mcp__") && !DENIED_PUBLIC_TOOL_NAME_SET.has(name);
}

export function isApprovedPublicPromptName(name: string): boolean {
  return !DENIED_PUBLIC_PROMPT_NAME_SET.has(name);
}

export function getDeniedPublicToolNames(): string[] {
  return [...DENIED_PUBLIC_TOOL_NAMES];
}
