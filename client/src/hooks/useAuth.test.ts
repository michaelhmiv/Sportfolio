import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("passwordless auth hook contract", () => {
  it("does not initialize the legacy auth client", () => {
    const source = readFileSync("client/src/hooks/useAuth.tsx", "utf8");
    expect(source).not.toContain("@supabase/supabase-js");
    expect(source).not.toContain("getSupabase");
    expect(source).not.toContain("signInWithPassword");
    expect(source).not.toContain("signInWithOAuth");
  });

  it("routes web and native sign-in through passwordless email", () => {
    const source = readFileSync("client/src/hooks/useAuth.tsx", "utf8");
    expect(source).toContain("requestPasswordlessEmail");
    expect(source).toContain("requestNativeMagicLink");
    expect(source).toContain("clearNativeAuthSession");
  });
});
