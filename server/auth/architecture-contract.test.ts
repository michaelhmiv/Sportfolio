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
    expect(adr).toContain("There is no dedicated authorization hostname");
    expect(adr).toContain("verified `sportfolio.market` domain");
  });

  it("records the shared-database execution boundary", () => {
    expect(adr).toContain("Beta and production intentionally share");
    expect(adr).toContain("Migration execution is production-runtime-only");
  });

  it("records Better Auth as the sole authentication provider", () => {
    expect(adr).toContain("Better Auth is the sole authentication provider");
    expect(adr).toContain("Legacy authentication, fallback token acceptance");
  });
});
