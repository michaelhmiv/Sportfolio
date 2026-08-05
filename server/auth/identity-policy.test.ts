import { describe, expect, it } from "vitest";
import {
  assertIdentityIsNotTombstoned,
  hashAuthEmailIdentity,
  normalizeAuthEmail,
} from "./identity-policy";

describe("authentication identity policy", () => {
  it("normalizes email identities deterministically", () => {
    expect(normalizeAuthEmail("  USER@Example.COM ")).toBe("user@example.com");
    expect(hashAuthEmailIdentity("USER@example.com")).toBe(
      hashAuthEmailIdentity(" user@EXAMPLE.com "),
    );
  });

  it("rejects malformed identities", () => {
    expect(() => normalizeAuthEmail("not-an-email")).toThrow("syntactically valid email");
  });

  it("blocks deleted provider subjects and email identities", () => {
    expect(() =>
      assertIdentityIsNotTombstoned(
        { authProviderSubjects: ["legacy-subject"] },
        { providerSubject: "legacy-subject" },
      ),
    ).toThrow("deletion tombstone");
    expect(() =>
      assertIdentityIsNotTombstoned(
        { authEmailIdentityHash: hashAuthEmailIdentity("deleted@example.com") },
        { email: "DELETED@example.com" },
      ),
    ).toThrow("deletion tombstone");
  });
});
