import type { Request } from "express";
import { describe, expect, it } from "vitest";
import {
  attachAuthPrincipal,
  getAuthPrincipal,
  requireAuthPrincipal,
  toLegacyRequestUser,
} from "./principal";

describe("provider-neutral authentication principal", () => {
  it("keeps canonical Sportfolio user id as the request subject", () => {
    expect(
      toLegacyRequestUser({
        userId: "canonical-user",
        provider: "better-auth",
        providerSubject: "auth-user",
      }).claims.sub,
    ).toBe("canonical-user");
  });
  it("attaches the principal and temporary legacy claim shape", () => {
    const req = {} as Request;
    attachAuthPrincipal(req, {
      userId: "canonical-user",
      provider: "better-auth",
      providerSubject: "auth-subject",
    });
    expect(getAuthPrincipal(req)?.providerSubject).toBe("auth-subject");
    expect((req as Request & { user?: { claims: { sub: string } } }).user?.claims.sub).toBe(
      "canonical-user",
    );
    expect(requireAuthPrincipal(req).userId).toBe("canonical-user");
  });
  it("rejects requests without a resolved principal", () => {
    expect(() => requireAuthPrincipal({} as Request)).toThrow("AUTH_PRINCIPAL_MISSING");
  });
});
