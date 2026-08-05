import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("passwordless authentication architecture contract", () => {
  const adr = readFileSync("docs/auth/passwordless-auth-adr.md", "utf8");
  const ownership = readFileSync("docs/auth/auth-data-ownership.md", "utf8");

  it("preserves Sportfolio users.id as the canonical application identity", () => {
    expect(adr).toContain("`users.id` remains the canonical");
    expect(adr).toContain("`auth_identities`");
    expect(ownership).toContain("Railway Postgres");
  });

  it("separates web sessions, MCP bearer tokens, and email infrastructure", () => {
    expect(adr).toContain("HttpOnly");
    expect(adr).toContain("MCP bearer");
    expect(adr).toContain("auth.sportfolio.market");
    expect(adr).toContain("mail.sportfolio.market");
  });

  it("records the shared-database execution boundary", () => {
    expect(adr).toContain("Beta and production intentionally share");
    expect(adr).toContain("Migration execution is production-runtime-only");
  });
});
