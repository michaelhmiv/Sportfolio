type HeaderValue = string | string[] | number | undefined;

const SENSITIVE_HEADER_NAME = /(authorization|cookie|session|subject|token|api[-_]?key|secret)/i;
const REDACTED = "[Redacted]";

export function sanitizeRequestHeaders(
  headers: Record<string, HeaderValue> | undefined,
): Record<string, HeaderValue> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER_NAME.test(name) ? REDACTED : value,
    ]),
  );
}

export function serializeRequestForLog(req: any) {
  const headers = (req?.raw?.headers || req?.headers || {}) as Record<string, HeaderValue>;
  return {
    id: req?.id,
    method: req?.method,
    url: req?.url,
    headers: sanitizeRequestHeaders(headers),
    remoteAddress: req?.remoteAddress || req?.socket?.remoteAddress,
    remotePort: req?.remotePort || req?.socket?.remotePort,
  };
}
