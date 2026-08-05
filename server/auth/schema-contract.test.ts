import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("additive authentication schema contract", () => {
  const schema = readFileSync("shared/schema.ts", "utf8");
  const migration = readFileSync("migrations/0064_passwordless_auth_identity_boundary.sql", "utf8");

  it("keeps users.id canonical", () => {
    expect(schema).toContain("export const users = pgTable(");
    expect(schema).toContain("export const authIdentities = pgTable(");
    expect(schema).toContain('references(() => users.id, { onDelete: "restrict" })');
  });

  it("namespaces Better Auth core tables", () => {
    for (const table of ["auth_users", "auth_sessions", "auth_accounts", "auth_verifications"]) {
      expect(schema).toContain(`"${table}"`);
      expect(migration).toContain(`"${table}"`);
    }
  });

  it("is additive", () => {
    const upperMigration = migration.toUpperCase();
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS");
    expect(upperMigration).not.toContain("DROP TABLE");
    expect(upperMigration).not.toContain("DROP COLUMN");
    expect(upperMigration).not.toContain("DROP CONSTRAINT");
    expect(upperMigration).not.toContain('ALTER TABLE "USERS"');
    expect(upperMigration).not.toContain('UPDATE "USERS"');
    expect(upperMigration).not.toContain('DELETE FROM "USERS"');
  });
});
