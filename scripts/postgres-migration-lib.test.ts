import { describe, expect, it } from "vitest";
import {
  buildDumpArgs,
  buildRestoreArgs,
  filterRestoreList,
  parseVerificationInventory,
  verifyInventoryParity,
} from "./postgres-migration-lib.mjs";

describe("postgres migration tooling", () => {
  it("removes Supabase RLS policy and row-security entries only", () => {
    const input = [
      "; archive header",
      "35; 2615 2200 SCHEMA - public pg_database_owner",
      "7000; 0 0 ROW SECURITY public users postgres",
      "7001; 3256 123 POLICY public users users_select postgres",
      "7002; 2606 124 CONSTRAINT public users users_pkey postgres",
      "",
    ].join("\n");

    const filtered = filterRestoreList(input);

    expect(filtered.content).toContain("SCHEMA - public");
    expect(filtered.content).toContain("CONSTRAINT public users users_pkey");
    expect(filtered.content).not.toContain("ROW SECURITY");
    expect(filtered.content).not.toContain("POLICY public");
    expect(filtered.removed).toEqual([
      "7000; 0 0 ROW SECURITY public users postgres",
      "7001; 3256 123 POLICY public users users_select postgres",
    ]);
  });

  it("builds owner-free custom dump and transactional restore arguments", () => {
    expect(buildDumpArgs("postgres://source", "/tmp/public.dump")).toEqual([
      "postgres://source",
      "--format=custom",
      "--compress=9",
      "--no-owner",
      "--no-privileges",
      "--schema=public",
      "--file=/tmp/public.dump",
    ]);
    expect(buildRestoreArgs("postgres://target", "/tmp/public.dump", "/tmp/restore.list")).toEqual([
      "--dbname=postgres://target",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "--single-transaction",
      "--use-list=/tmp/restore.list",
      "/tmp/public.dump",
    ]);
  });

  it("rejects row-count, object-count, constraint, policy, and auth-reference drift", () => {
    const source = parseVerificationInventory(
      JSON.stringify({
        tables: { users: 4, holdings: 8 },
        objects: { tables: 2, views: 0, functions: 3, triggers: 1 },
        invalidForeignKeys: 0,
        policies: 7,
        rowSecurityTables: 2,
        authFunctionReferences: 0,
      }),
    );
    const target = parseVerificationInventory(
      JSON.stringify({
        tables: { users: 4, holdings: 7 },
        objects: { tables: 2, views: 0, functions: 3, triggers: 1 },
        invalidForeignKeys: 1,
        policies: 0,
        rowSecurityTables: 0,
        authFunctionReferences: 1,
      }),
    );

    expect(verifyInventoryParity(source, target)).toEqual([
      "row count mismatch for holdings: source=8 target=7",
      "target has 1 invalid foreign key(s)",
      "target has 1 public function(s) referencing auth.*",
    ]);
  });

  it("accepts matching data with RLS removed from the target", () => {
    const source = parseVerificationInventory(
      JSON.stringify({
        tables: { users: 4 },
        objects: { tables: 1, views: 0, functions: 0, triggers: 0 },
        invalidForeignKeys: 0,
        policies: 5,
        rowSecurityTables: 1,
        authFunctionReferences: 0,
      }),
    );
    const target = parseVerificationInventory(
      JSON.stringify({
        tables: { users: 4 },
        objects: { tables: 1, views: 0, functions: 0, triggers: 0 },
        invalidForeignKeys: 0,
        policies: 0,
        rowSecurityTables: 0,
        authFunctionReferences: 0,
      }),
    );

    expect(verifyInventoryParity(source, target)).toEqual([]);
  });
});
