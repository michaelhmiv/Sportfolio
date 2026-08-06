import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizePasswordlessReturnTo } from "./passwordless-auth";

describe("passwordless web surface contract", () => {
  it("rejects external return paths", () => {
    expect(normalizePasswordlessReturnTo("https://evil.example")).toBe("/");
    expect(normalizePasswordlessReturnTo("//evil.example")).toBe("/");
    expect(normalizePasswordlessReturnTo("/portfolio?tab=players")).toBe("/portfolio?tab=players");
  });
  it("routes web login through a passwordless component and completion page", () => {
    const login = readFileSync("client/src/pages/Login.tsx", "utf8");
    const app = readFileSync("client/src/App.tsx", "utf8");
    expect(login).toContain("PasswordlessWebLogin");
    expect(login).toContain("fetchAuthCapabilities");
    expect(login).toContain("passwordlessWebEnabled === true");
    expect(app).toContain('path="/auth/complete"');
  });
  it("allows cookie-authenticated web user fetches without a Supabase token", () => {
    const auth = readFileSync("client/src/hooks/useAuth.tsx", "utf8");
    expect(auth).toContain('credentials: "include"');
    expect(auth).toContain("requestMagicLink");
    expect(auth).toContain("broadcastWebAuthChange");
  });
});
