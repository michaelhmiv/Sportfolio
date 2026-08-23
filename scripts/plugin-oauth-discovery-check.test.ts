import { describe, expect, it } from "vitest";
import {
  buildAuthorizationServerDiscoveryUrl,
  validateAsymmetricJwks,
  validateAuthorizationServerMetadata,
} from "./plugin-oauth-discovery-check";

const issuer = "https://auth.example.test/api/auth/better";

describe("plugin OAuth discovery compatibility", () => {
  it("builds RFC 8414 discovery URLs for a path issuer", () => {
    expect(buildAuthorizationServerDiscoveryUrl(issuer)).toBe(
      "https://auth.example.test/.well-known/oauth-authorization-server/api/auth/better",
    );
  });

  it("accepts a complete Better Auth OAuth metadata document", () => {
    const result = validateAuthorizationServerMetadata(issuer, {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      registration_endpoint: `${issuer}/oauth/clients/register`,
      grant_types_supported: ["authorization_code", "refresh_token"],
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
    });

    expect(result.failures).toEqual([]);
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
  });

  it("rejects missing DCR, PKCE, refresh, and public-client support", () => {
    const result = validateAuthorizationServerMetadata(issuer, {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      grant_types_supported: ["authorization_code"],
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["plain"],
      token_endpoint_auth_methods_supported: ["client_secret_basic"],
    });

    expect(result.failures).toEqual(
      expect.arrayContaining([
        "dynamicClientRegistrationAdvertised",
        "refreshTokenSupported",
        "pkceS256Supported",
        "publicClientAuthSupported",
      ]),
    );
  });

  it("requires an asymmetric JWKS key", () => {
    expect(validateAsymmetricJwks({ keys: [{ kty: "RSA", kid: "key-1" }] })).toBe(true);
    expect(validateAsymmetricJwks({ keys: [{ kty: "oct", kid: "legacy-secret" }] })).toBe(false);
    expect(validateAsymmetricJwks({ keys: [] })).toBe(false);
  });
});
