import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "migrations/0065_drop_retired_product_surfaces.sql"),
  "utf8",
);
const runbook = readFileSync(
  resolve(process.cwd(), "docs/runbooks/retired-product-database-cleanup.md"),
  "utf8",
);

const quotedTable = (...segments: string[]) => `"${segments.join("_")}"`;
const dropPosition = (...segments: string[]) =>
  migration.indexOf(`DROP TABLE IF EXISTS ${quotedTable(...segments)};`);

describe("retired product database cleanup", () => {
  it("is explicit, transactional, and never uses broad cascade deletion", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
    expect(migration).not.toMatch(/\bCASCADE\b/i);
    expect(migration.match(/DROP TABLE IF EXISTS/g)?.length).toBeGreaterThan(10);
  });

  it("drops foreign-key children before their parent records", () => {
    const thread = dropPosition("user", "agent", "threads");
    expect(dropPosition("agent", "runtime", "sessions")).toBeLessThan(thread);
    expect(dropPosition("sms", "message", "events")).toBeLessThan(thread);
    expect(dropPosition("user", "agent", "messages")).toBeLessThan(thread);
    expect(dropPosition("user", "agent", "runs")).toBeLessThan(thread);
  });

  it("documents backup, inventory, controlled execution, verification, and rollback", () => {
    for (const heading of ["Preconditions", "Inventory", "Execution", "Verification", "Rollback"]) {
      expect(runbook).toContain(`## ${heading}`);
    }
    expect(runbook).toMatch(/backup/i);
    expect(runbook).toMatch(/run exactly once/i);
  });
});
