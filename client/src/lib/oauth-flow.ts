const SIGNATURE_PARAM = "sig";
const SIGNED_PARAMETER_MARKER = "ba_param";
const NESTED_OAUTH_QUERY_KEYS = [
  "oauth_query",
  "auth_query",
  "authorization_query",
  "authorization_request",
] as const;

function normalizeInternalPath(candidate: string | null | undefined): string | null {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return null;
  return candidate;
}

function parseQuery(candidate: string): URLSearchParams {
  const trimmed = candidate.startsWith("?") ? candidate.slice(1) : candidate;
  return new URLSearchParams(trimmed);
}

function signedOAuthQuery(params: URLSearchParams): string | null {
  if (!params.has(SIGNATURE_PARAM) || !params.has(SIGNED_PARAMETER_MARKER)) return null;
  return params.toString();
}

export type OAuthConsentRequest = {
  clientId: string | null;
  scope: string;
  oauthQuery: string | null;
};

export function resolveOAuthConsentRequest(search: string): OAuthConsentRequest {
  const outer = parseQuery(search);
  const candidates: URLSearchParams[] = [outer];

  for (const key of NESTED_OAUTH_QUERY_KEYS) {
    const nested = outer.get(key);
    if (!nested) continue;
    const parsed = parseQuery(nested);
    if ([...parsed.keys()].length) candidates.push(parsed);
  }

  const withClient = candidates.find((params) => Boolean(params.get("client_id"))) ?? outer;
  const signed = candidates.find((params) => Boolean(signedOAuthQuery(params))) ?? null;

  return {
    clientId: withClient.get("client_id"),
    scope: withClient.get("scope") || "openid",
    oauthQuery: signed ? signedOAuthQuery(signed) : null,
  };
}

export function resolveOAuthLoginReturnTo(search: string): string {
  const params = parseQuery(search);
  const explicitRedirect = normalizeInternalPath(params.get("redirect"));
  if (explicitRedirect) return explicitRedirect;

  const request = resolveOAuthConsentRequest(search);
  if (!request.clientId || !request.oauthQuery) return "/";
  return `/oauth/consent?${request.oauthQuery}`;
}
