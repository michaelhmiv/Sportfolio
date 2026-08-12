import { describe, expect, it } from "vitest";
import { resolveOAuthConsentRequest, resolveOAuthLoginReturnTo } from "./oauth-flow";

const signedOAuthQuery = new URLSearchParams({
  client_id: "chatgpt-client",
  redirect_uri: "https://chatgpt.com/aip/callback",
  response_type: "code",
  scope: "openid sportfolio.read sportfolio.trade",
  code_challenge: "challenge",
  code_challenge_method: "S256",
  state: "state-value",
  exp: "1786190000",
  ba_iat: "1786189000000",
  sig: "signature",
});
for (const parameter of [
  "ba_iat",
  "client_id",
  "code_challenge",
  "code_challenge_method",
  "exp",
  "redirect_uri",
  "response_type",
  "scope",
  "state",
  "ba_param",
]) {
  signedOAuthQuery.append("ba_param", parameter);
}

const signedSearch = `?${signedOAuthQuery.toString()}`;

describe("resolveOAuthConsentRequest", () => {
  it("reads Better Auth signed OAuth consent parameters", () => {
    const request = resolveOAuthConsentRequest(signedSearch);

    expect(request.clientId).toBe("chatgpt-client");
    expect(request.scope).toBe("openid sportfolio.read sportfolio.trade");
    expect(request.oauthQuery).toContain("client_id=chatgpt-client");
    expect(request.oauthQuery).toContain("sig=signature");
  });

  it("recovers a signed OAuth request wrapped by an auth_query parameter", () => {
    const wrapped = `?auth_query=${encodeURIComponent(signedOAuthQuery.toString())}`;
    const request = resolveOAuthConsentRequest(wrapped);

    expect(request.clientId).toBe("chatgpt-client");
    expect(request.scope).toBe("openid sportfolio.read sportfolio.trade");
    expect(request.oauthQuery).toContain("sig=signature");
  });

  it("fails closed for an unsigned or incomplete request", () => {
    expect(resolveOAuthConsentRequest("?scope=openid")).toEqual({
      clientId: null,
      scope: "openid",
      oauthQuery: null,
    });
  });
});

describe("resolveOAuthLoginReturnTo", () => {
  it("preserves an explicit safe redirect", () => {
    expect(resolveOAuthLoginReturnTo("?redirect=%2Fportfolio%3Ftab%3Dholdings")).toBe(
      "/portfolio?tab=holdings",
    );
  });

  it("turns a Better Auth signed login query into a consent continuation", () => {
    const destination = resolveOAuthLoginReturnTo(signedSearch);

    expect(destination.startsWith("/oauth/consent?")).toBe(true);
    expect(destination).toContain("client_id=chatgpt-client");
    expect(destination).toContain("sig=signature");
  });

  it("does not preserve unsigned OAuth-looking state", () => {
    expect(resolveOAuthLoginReturnTo("?client_id=chatgpt-client&scope=openid")).toBe("/");
  });

  it("rejects protocol-relative redirects", () => {
    expect(resolveOAuthLoginReturnTo("?redirect=%2F%2Fevil.example%2Fcallback")).toBe("/");
  });
});
