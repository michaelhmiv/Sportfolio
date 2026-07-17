#!/usr/bin/env node
/* global process, console, URL */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildDumpArgs,
  buildRestoreArgs,
  filterRestoreList,
  parseVerificationInventory,
  verifyInventoryParity,
} from "./postgres-migration-lib.mjs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function run(program, args, options = {}) {
  return execFileSync(program, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture === false ? "inherit" : ["pipe", "pipe", "pipe"],
    input: options.input,
  });
}

function psql(databaseUrl, sql) {
  return run(
    process.env.PSQL_BIN || "psql",
    [databaseUrl, "-X", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1"],
    { input: sql },
  ).trim();
}

function assertDifferentDatabases(sourceUrl, targetUrl) {
  const source = new URL(sourceUrl);
  const target = new URL(targetUrl);
  const sourceIdentity = `${source.hostname}:${source.port}/${source.pathname}`;
  const targetIdentity = `${target.hostname}:${target.port}/${target.pathname}`;
  if (sourceIdentity === targetIdentity) {
    throw new Error("source and target database URLs resolve to the same host, port, and database");
  }
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function artifactDirectory() {
  const directory = resolve(
    process.env.MIGRATION_ARTIFACT_DIR || `/tmp/sportfolio-postgres-migration-${timestamp()}`,
  );
  mkdirSync(directory, { recursive: true });
  return directory;
}

function collectInventory(databaseUrl) {
  const tableRows = psql(
    databaseUrl,
    `SELECT format(
       'SELECT %L AS table_name, count(*)::bigint AS row_count FROM public.%I;',
       tablename,
       tablename
     )
     FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename
     \\gexec
`,
  );
  const tables = {};
  for (const line of tableRows.split("\n").filter(Boolean)) {
    const [name, count] = line.split("\t");
    tables[name] = Number(count);
  }

  const objectRows = psql(
    databaseUrl,
    `SELECT kind, count FROM (
       SELECT 'tables' AS kind, count(*)::bigint AS count
         FROM pg_tables WHERE schemaname = 'public'
       UNION ALL
       SELECT 'views', count(*)::bigint
         FROM pg_views WHERE schemaname = 'public'
       UNION ALL
       SELECT 'functions', count(*)::bigint
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
       UNION ALL
       SELECT 'triggers', count(*)::bigint
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
     ) counts ORDER BY kind;
`,
  );
  const objects = {};
  for (const line of objectRows.split("\n").filter(Boolean)) {
    const [kind, count] = line.split("\t");
    objects[kind] = Number(count);
  }

  const diagnostics = psql(
    databaseUrl,
    `SELECT
       (SELECT count(*) FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND con.contype = 'f' AND NOT con.convalidated),
       (SELECT count(*) FROM pg_policy pol
         JOIN pg_class c ON c.oid = pol.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'),
       (SELECT count(*) FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relrowsecurity),
       (SELECT count(*) FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prokind IN ('f', 'p')
          AND pg_get_functiondef(p.oid) ~ 'auth\\.');
`,
  ).split("\t");

  return parseVerificationInventory(
    JSON.stringify({
      tables,
      objects,
      invalidForeignKeys: Number(diagnostics[0]),
      policies: Number(diagnostics[1]),
      rowSecurityTables: Number(diagnostics[2]),
      authFunctionReferences: Number(diagnostics[3]),
    }),
  );
}

function dump() {
  const sourceUrl = requiredEnv("SOURCE_DATABASE_URL");
  const directory = artifactDirectory();
  const dumpPath = resolve(directory, "public.dump");
  const rawListPath = resolve(directory, "public.list");
  const filteredListPath = resolve(directory, "public.railway.list");

  run(process.env.PG_DUMP_BIN || "pg_dump", buildDumpArgs(sourceUrl, dumpPath), {
    capture: false,
  });
  const rawList = run(process.env.PG_RESTORE_BIN || "pg_restore", ["--list", dumpPath]);
  const filtered = filterRestoreList(rawList);
  writeFileSync(rawListPath, rawList);
  writeFileSync(filteredListPath, filtered.content);
  writeFileSync(
    resolve(directory, "manifest.json"),
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        dumpPath,
        rawListPath,
        filteredListPath,
        removedRlsEntries: filtered.removed.length,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    JSON.stringify({
      directory,
      dumpPath,
      rawListPath,
      filteredListPath,
      removed: filtered.removed.length,
    }),
  );
}

function restore() {
  const targetUrl = requiredEnv("TARGET_DATABASE_URL");
  const dumpPath = resolve(requiredEnv("DUMP_PATH"));
  const listPath = resolve(requiredEnv("RESTORE_LIST_PATH"));
  readFileSync(dumpPath);
  readFileSync(listPath, "utf8");

  const existingTables = Number(
    psql(targetUrl, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';\n"),
  );
  if (existingTables > 0 && process.env.ALLOW_NONEMPTY_TARGET !== "true") {
    throw new Error(
      `target public schema has ${existingTables} table(s); set ALLOW_NONEMPTY_TARGET=true only for a disposable target`,
    );
  }

  run(process.env.PG_RESTORE_BIN || "pg_restore", buildRestoreArgs(targetUrl, dumpPath, listPath), {
    capture: false,
  });
}

function verify() {
  const sourceUrl = requiredEnv("SOURCE_DATABASE_URL");
  const targetUrl = requiredEnv("TARGET_DATABASE_URL");
  assertDifferentDatabases(sourceUrl, targetUrl);
  const directory = artifactDirectory();
  const source = collectInventory(sourceUrl);
  const target = collectInventory(targetUrl);
  const errors = verifyInventoryParity(source, target);
  writeFileSync(
    resolve(directory, "source-inventory.json"),
    `${JSON.stringify(source, null, 2)}\n`,
  );
  writeFileSync(
    resolve(directory, "target-inventory.json"),
    `${JSON.stringify(target, null, 2)}\n`,
  );
  writeFileSync(
    resolve(directory, "verification.json"),
    `${JSON.stringify({ errors }, null, 2)}\n`,
  );
  if (errors.length) {
    throw new Error(`migration verification failed:\n- ${errors.join("\n- ")}`);
  }
  console.log(
    JSON.stringify({
      status: "verified",
      directory,
      tableCount: Object.keys(source.tables).length,
    }),
  );
}

const command = process.argv[2];
try {
  if (command === "dump") dump();
  else if (command === "restore") restore();
  else if (command === "verify") verify();
  else throw new Error("usage: postgres-migration.mjs <dump|restore|verify>");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
