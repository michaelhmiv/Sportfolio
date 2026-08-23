export const PUBLIC_ERROR_CODES = [
  "invalid_input",
  "unauthorized",
  "auth_expired",
  "not_found",
  "ineligible",
  "conflict",
  "stale_transaction",
  "provider_unavailable",
  "timeout",
  "retryable_transient",
  "internal_failure",
] as const;

export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

export type NormalizedPublicError = {
  code: PublicErrorCode;
  message: string;
  retryable: boolean;
};

const SAFE_ERROR_NAMES = new Set(["PublicMcpToolError"]);
const INTERNAL_MESSAGE_PATTERNS = [
  /exceptiongroup/i,
  /taskgroup/i,
  /stack trace/i,
  /\bat\s+[^\s]+\([^)]*:\d+:/i,
  /password|secret|token|authorization|cookie/i,
];

const STABLE_MESSAGES: Record<PublicErrorCode, string> = {
  invalid_input: "The supplied arguments are invalid.",
  unauthorized: "Connect your Sportfolio account to use this tool.",
  auth_expired: "Your Sportfolio connection has expired. Reconnect and try again.",
  not_found: "The requested Sportfolio record was not found.",
  ineligible: "This action is not currently eligible.",
  conflict: "The requested action conflicts with the current Sportfolio state.",
  stale_transaction: "This staged action is stale or has expired. Stage it again.",
  provider_unavailable: "The requested sports data provider is temporarily unavailable.",
  timeout: "Sportfolio took too long to respond. Try again.",
  retryable_transient: "Sportfolio encountered a temporary failure. Try again.",
  internal_failure: "Sportfolio could not complete this request.",
};

function rawCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function rawMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as { message?: unknown }).message;
  return typeof value === "string" ? value.trim() : "";
}

function isSafeMessage(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  if (typeof name !== "string" || !SAFE_ERROR_NAMES.has(name)) return false;
  const message = rawMessage(error);
  return (
    Boolean(message) &&
    message.length <= 500 &&
    !INTERNAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
  );
}

function mapCode(code: string, error: unknown): PublicErrorCode {
  const message = rawMessage(error).toLowerCase();
  if (
    code === "invalid_argument" ||
    code === "invalid_arguments" ||
    code === "invalid_input" ||
    code === "unsupported_sport" ||
    code === "request_too_broad"
  ) {
    return "invalid_input";
  }
  if (code === "invalid_token" || code === "unauthorized" || code === "authentication_required") {
    return "unauthorized";
  }
  if (code === "auth_expired" || code === "expired_token") return "auth_expired";
  if (code === "not_found" || code === "unknown_public_tool" || code === "unknown_public_prompt") {
    return "not_found";
  }
  if (code === "ineligible" || code === "not_eligible") return "ineligible";
  if (
    code === "stale_transaction" ||
    code === "expired_transaction" ||
    code === "transaction_expired"
  ) {
    return "stale_transaction";
  }
  if (code === "conflict" || code === "transaction_conflict") return "conflict";
  if (
    code === "provider_unavailable" ||
    code === "upstream_unavailable" ||
    code === "provider_error"
  ) {
    return "provider_unavailable";
  }
  if (
    code === "timeout" ||
    code === "tool_timeout" ||
    code === "deadline_exceeded" ||
    (error &&
      typeof error === "object" &&
      (error as { name?: unknown }).name === "PluginDeadlineError")
  ) {
    return "timeout";
  }
  if (code === "retryable_transient" || code === "transient" || code === "retryable") {
    return "retryable_transient";
  }
  if (/not found|does not exist/.test(message)) return "not_found";
  if (/not eligible|ineligible|not currently eligible/.test(message)) return "ineligible";
  if (/stale|expired/.test(message) && /transaction|action|preview/.test(message)) {
    return "stale_transaction";
  }
  if (/already exists|already taken|conflict/.test(message)) return "conflict";
  if (/provider.*unavailable|upstream.*unavailable|sports data.*unavailable/.test(message)) {
    return "provider_unavailable";
  }
  if (/timed out|timeout/.test(message)) return "timeout";
  if (/authentication required|connect your sportfolio|unauthorized/.test(message)) {
    return "unauthorized";
  }
  if (/temporar|econnreset|econnrefused|503/.test(message)) return "retryable_transient";
  return "internal_failure";
}

export function normalizePublicError(error: unknown): NormalizedPublicError {
  const code = mapCode(rawCode(error), error);
  const message = isSafeMessage(error) ? rawMessage(error) : STABLE_MESSAGES[code];
  return {
    code,
    message,
    retryable:
      code === "timeout" || code === "retryable_transient" || code === "provider_unavailable",
  };
}
