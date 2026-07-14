import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "migrations/0050_split_collection_pair_identity_triggers.sql",
);

function readMigration(): string {
  return readFileSync(migrationPath, "utf8");
}

function functionBody(migration: string, functionName: string): string {
  const match = migration.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION ${functionName}\\(\\)[\\s\\S]+?AS \\$\\$([\\s\\S]+?)\\$\\$;`,
      "i",
    ),
  );
  expect(match, `${functionName} must be declared`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("collection pair-identity trigger repair migration", () => {
  it("replaces the heterogeneous trigger function with table-specific functions", () => {
    const migration = readMigration();

    expect(migration).toContain(
      "DROP TRIGGER IF EXISTS user_collection_allocations_lock_reference_immutable",
    );
    expect(migration).toContain(
      "DROP TRIGGER IF EXISTS holdings_locks_collection_reference_immutable",
    );
    expect(migration).toContain(
      "DROP FUNCTION IF EXISTS prevent_collection_pair_identity_mutation()",
    );

    expect(migration).toContain(
      "EXECUTE FUNCTION prevent_collection_allocation_reference_mutation()",
    );
    expect(migration).toContain(
      "EXECUTE FUNCTION prevent_collection_holdings_lock_reference_mutation()",
    );
  });

  it("never accesses holdings-lock fields from the allocation trigger", () => {
    const migration = readMigration();
    const allocationBody = functionBody(
      migration,
      "prevent_collection_allocation_reference_mutation",
    );

    expect(allocationBody).toContain(
      "OLD.lock_reference_id IS DISTINCT FROM NEW.lock_reference_id",
    );
    expect(allocationBody).not.toContain("lock_type");
    expect(allocationBody).not.toContain("TG_TABLE_NAME");
  });

  it("keeps collection lock-reference identity immutable on holdings locks", () => {
    const migration = readMigration();
    const holdingsLockBody = functionBody(
      migration,
      "prevent_collection_holdings_lock_reference_mutation",
    );

    expect(holdingsLockBody).toContain(
      "OLD.lock_type = 'collection' OR NEW.lock_type = 'collection'",
    );
    expect(holdingsLockBody).toContain(
      "OLD.lock_reference_id IS DISTINCT FROM NEW.lock_reference_id",
    );
    expect(holdingsLockBody).not.toContain("TG_TABLE_NAME");
  });
});
