import { chmodSync, lstatSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertDifferentDatabases,
  assertNoActiveTargetClients,
  assertNonemptyTargetOverride,
  assertPrivateArtifactFile,
  buildDumpArgs,
  buildRestoreArgs,
  databaseIdentity,
  ensurePrivateArtifactDirectory,
  filterRestoreList,
  nonemptyTargetConfirmationToken,
  normalizeStructuralDefinition,
  parseVerificationInventory,
  postgresConnectionEnvironment,
  postgresDatabaseName,
  SEQUENCE_VALUES_SQL,
  STRUCTURAL_DEFINITIONS_SQL,
  structuralDefinitionFingerprint,
  verifyInventoryParity,
  writePrivateArtifactFile,
} from "./postgres-migration-lib.mjs";

const hashA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const hashB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("postgres migration tooling", () => {
  it("normalizes equivalent PostgreSQL 17 and 18 varchar-array CHECK deparsing", () => {
    const pg17 =
      "((state)::text = ANY ((ARRAY['draft'::character varying, 'final'::character varying])::text[]))";
    const pg18 =
      "((state)::text = ANY (ARRAY[('draft'::character varying)::text, ('final'::character varying)::text]))";

    expect(normalizeStructuralDefinition(pg17)).toBe(normalizeStructuralDefinition(pg18));
    expect(structuralDefinitionFingerprint(pg17)).toBe(structuralDefinitionFingerprint(pg18));
    expect(structuralDefinitionFingerprint(pg17)).not.toBe(
      structuralDefinitionFingerprint(pg18.replace("final", "disabled")),
    );
  });

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
    expect(buildDumpArgs("/tmp/public.dump")).toEqual([
      "--format=custom",
      "--compress=9",
      "--no-owner",
      "--no-privileges",
      "--schema=public",
      "--file=/tmp/public.dump",
    ]);
    expect(buildRestoreArgs("/tmp/public.dump", "/tmp/restore.list", "railway")).toEqual([
      "--dbname=railway",
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

  it("moves database credentials out of process arguments", () => {
    const env = postgresConnectionEnvironment(
      "postgresql://user:p%40ss@db.example:6543/app?sslmode=require",
      { PATH: "/bin" },
    );
    expect(env).toMatchObject({
      PATH: "/bin",
      PGHOST: "db.example",
      PGPORT: "6543",
      PGDATABASE: "app",
      PGUSER: "user",
      PGPASSWORD: "p@ss",
      PGSSLMODE: "require",
    });
    expect(buildDumpArgs("/tmp/public.dump").join(" ")).not.toContain("postgresql://");
    expect(postgresDatabaseName("postgresql://user:secret@db.example:5432/app")).toBe("app");
    expect(buildRestoreArgs("/tmp/public.dump", "/tmp/list", "app").join(" ")).not.toContain(
      "postgresql://",
    );
  });

  it("normalizes an omitted PostgreSQL port in the same-target guard", () => {
    expect(databaseIdentity("postgresql://one@DB.EXAMPLE/app")).toBe("db.example:5432/app");
    expect(() =>
      assertDifferentDatabases(
        "postgresql://one:secret@db.example/app",
        "postgresql://two:different@DB.EXAMPLE:5432/app?sslmode=require",
      ),
    ).toThrow(/same host, port, and database/);
  });

  it("requires a target-specific confirmation for a nonempty restore", () => {
    const target = "postgresql://user@railway.example:6543/sportfolio";
    const token = nonemptyTargetConfirmationToken(target);
    expect(token).toBe("ERASE railway.example:6543/sportfolio");
    expect(() =>
      assertNonemptyTargetOverride(3, target, { ALLOW_NONEMPTY_TARGET: "true" }),
    ).toThrow(token);
    expect(() =>
      assertNonemptyTargetOverride(3, target, {
        ALLOW_NONEMPTY_TARGET: "true",
        CONFIRM_NONEMPTY_TARGET: "ERASE another.example:6543/sportfolio",
      }),
    ).toThrow(token);
    expect(() =>
      assertNonemptyTargetOverride(3, target, {
        ALLOW_NONEMPTY_TARGET: "true",
        CONFIRM_NONEMPTY_TARGET: token,
      }),
    ).not.toThrow();
  });

  it("refuses restore while another client is using the target", () => {
    expect(() => assertNoActiveTargetClients(2)).toThrow(/2 other client connection/);
    expect(() => assertNoActiveTargetClients(0)).not.toThrow();
  });

  it("creates private artifacts and rejects insecure pre-existing paths", () => {
    const root = mkdtempSync(join(tmpdir(), "sportfolio-migration-test-"));
    const directory = join(root, "artifacts");
    ensurePrivateArtifactDirectory(directory);
    expect(lstatSync(directory).mode & 0o777).toBe(0o700);

    const artifact = join(directory, "manifest.json");
    writePrivateArtifactFile(artifact, "{}\n");
    expect(lstatSync(artifact).mode & 0o777).toBe(0o600);
    expect(() => assertPrivateArtifactFile(artifact, "manifest")).not.toThrow();

    const insecureDirectory = join(root, "insecure");
    ensurePrivateArtifactDirectory(insecureDirectory);
    chmodSync(insecureDirectory, 0o755);
    expect(() => ensurePrivateArtifactDirectory(insecureDirectory)).toThrow(/mode 0700/);

    const insecureFile = join(directory, "insecure.dump");
    writeFileSync(insecureFile, "dump", { mode: 0o644 });
    expect(() => assertPrivateArtifactFile(insecureFile, "dump")).toThrow(/mode 0600/);

    const symlink = join(directory, "linked.dump");
    symlinkSync(insecureFile, symlink);
    expect(() => assertPrivateArtifactFile(symlink, "dump")).toThrow(/regular file/);
  });

  it("inventories checks, sequence state and ownership, and user-defined types", () => {
    expect(STRUCTURAL_DEFINITIONS_SQL).toContain("pg_get_expr(con.conbin");
    expect(STRUCTURAL_DEFINITIONS_SQL).toContain("con.convalidated");
    expect(STRUCTURAL_DEFINITIONS_SQL).toContain("sequence-ownership/");
    expect(SEQUENCE_VALUES_SQL).toContain("last_value");
    expect(SEQUENCE_VALUES_SQL).toContain("is_called");
    expect(STRUCTURAL_DEFINITIONS_SQL).toContain("types/enum/");
    expect(STRUCTURAL_DEFINITIONS_SQL).toContain("types/domain/");
    expect(STRUCTURAL_DEFINITIONS_SQL).toContain("types/composite/");
    expect(STRUCTURAL_DEFINITIONS_SQL).toContain("types/range/");
  });

  it("rejects row-count, structural, constraint, policy, and auth-reference drift", () => {
    const source = parseVerificationInventory(
      JSON.stringify({
        tables: { users: 4, holdings: 8 },
        objects: { tables: 2, views: 0, functions: 3, triggers: 1 },
        definitions: { columns: hashA },
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
        definitions: { columns: hashB },
        invalidForeignKeys: 1,
        policies: 0,
        rowSecurityTables: 0,
        authFunctionReferences: 1,
      }),
    );

    expect(verifyInventoryParity(source, target)).toEqual([
      "row count mismatch for holdings: source=8 target=7",
      "definition mismatch for columns",
      "target has 1 invalid foreign key(s)",
      "target has 1 public function(s) referencing auth.*",
    ]);
  });

  it("accepts matching data and definitions with RLS removed from the target", () => {
    const source = parseVerificationInventory(
      JSON.stringify({
        tables: { users: 4 },
        objects: { tables: 1, views: 0, functions: 0, triggers: 0 },
        definitions: { columns: hashA },
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
        definitions: { columns: hashA },
        invalidForeignKeys: 0,
        policies: 0,
        rowSecurityTables: 0,
        authFunctionReferences: 0,
      }),
    );

    expect(verifyInventoryParity(source, target)).toEqual([]);
  });
});
