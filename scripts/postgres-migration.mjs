#!/usr/bin/env node
/* global process, console, URL */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildDumpArgs,
  buildRestoreArgs,
  filterRestoreList,
  parseVerificationInventory,
  postgresConnectionEnvironment,
  postgresDatabaseName,
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
    env: options.databaseUrl ? postgresConnectionEnvironment(options.databaseUrl) : process.env,
  });
}

function psql(databaseUrl, sql) {
  return run(
    process.env.PSQL_BIN || "psql",
    ["-X", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1"],
    { input: sql, databaseUrl },
  ).trim();
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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

  const definitions = {};
  const definitionRows = psql(
    databaseUrl,
    `WITH definitions(object_key, definition) AS (
       SELECT 'columns/' || table_name || '.' || column_name,
         format('%s|%s|%s|%s', udt_schema || '.' || udt_name, is_nullable,
           COALESCE(column_default, ''), COALESCE(identity_generation, ''))
       FROM information_schema.columns WHERE table_schema = 'public'
       UNION ALL
       SELECT 'constraints/' || con.conrelid::regclass::text || '.' || con.conname,
         format('%s|%s|%s|%s|%s|%s|%s|%s', con.contype,
           (SELECT array_agg(a.attname ORDER BY keys.ordinality)
              FROM unnest(con.conkey) WITH ORDINALITY keys(attnum, ordinality)
              JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = keys.attnum),
           con.confrelid::regclass::text,
           (SELECT array_agg(a.attname ORDER BY keys.ordinality)
              FROM unnest(con.confkey) WITH ORDINALITY keys(attnum, ordinality)
              JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = keys.attnum),
           con.confupdtype, con.confdeltype, con.confmatchtype, con.condeferrable)
       FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
       WHERE n.nspname = 'public' AND con.contype <> 'n'
       UNION ALL
       SELECT 'indexes/' || ic.relname, pg_get_indexdef(i.indexrelid)
       FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_class ic ON ic.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
       UNION ALL
       SELECT 'views/' || c.relname, pg_get_viewdef(c.oid, true)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
       UNION ALL
       SELECT 'functions/' || p.oid::regprocedure::text, pg_get_functiondef(p.oid)
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
       UNION ALL
       SELECT 'triggers/' || c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid, true)
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal
       UNION ALL
       SELECT 'sequences/' || sequence_name, format('%s|%s|%s|%s|%s', data_type,
         start_value, minimum_value, maximum_value, increment)
       FROM information_schema.sequences WHERE sequence_schema = 'public'
       UNION ALL
       SELECT 'relations/' || c.relname, format('%s|%s|%s', c.relkind, c.relpersistence,
         COALESCE(pg_get_partkeydef(c.oid), ''))
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
     )
     SELECT object_key, md5(definition) FROM definitions ORDER BY object_key;
`,
  );
  for (const line of definitionRows.split("\n").filter(Boolean)) {
    const [objectKey, hash] = line.split("\t");
    definitions[objectKey] = hash;
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
          AND (
            pg_get_functiondef(p.oid) ~* '("?auth"?)[[:space:]]*\\.[[:space:]]*'
            OR COALESCE(array_to_string(p.proconfig, ','), '') ~* 'search_path[^,]*auth'
          ));
`,
  ).split("\t");

  return parseVerificationInventory(
    JSON.stringify({
      tables,
      objects,
      definitions,
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

  run(process.env.PG_DUMP_BIN || "pg_dump", buildDumpArgs(dumpPath), {
    capture: false,
    databaseUrl: sourceUrl,
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
        dumpSha256: sha256File(dumpPath),
        rawListSha256: sha256File(rawListPath),
        filteredListSha256: sha256File(filteredListPath),
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
  const sourceUrl = requiredEnv("SOURCE_DATABASE_URL");
  const targetUrl = requiredEnv("TARGET_DATABASE_URL");
  assertDifferentDatabases(sourceUrl, targetUrl);

  const dumpPath = resolve(requiredEnv("DUMP_PATH"));
  const listPath = resolve(requiredEnv("RESTORE_LIST_PATH"));
  accessSync(dumpPath);
  accessSync(listPath);
  if (!statSync(dumpPath).isFile() || statSync(dumpPath).size === 0) {
    throw new Error("DUMP_PATH must be a non-empty regular file");
  }
  const suppliedList = readFileSync(listPath, "utf8");
  const archiveList = run(process.env.PG_RESTORE_BIN || "pg_restore", ["--list", dumpPath]);
  const expectedList = filterRestoreList(archiveList).content;
  if (suppliedList !== expectedList) {
    throw new Error(
      "RESTORE_LIST_PATH does not match the RLS-filtered table of contents for DUMP_PATH",
    );
  }

  const existingObjects = Number(
    psql(
      targetUrl,
      `SELECT
         (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f'))
       + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public')
       + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typrelid = 0 AND t.typelem = 0);\n`,
    ),
  );
  if (existingObjects > 0 && process.env.ALLOW_NONEMPTY_TARGET !== "true") {
    throw new Error(
      `target public schema has ${existingObjects} object(s); set ALLOW_NONEMPTY_TARGET=true only for a disposable target`,
    );
  }

  run(
    process.env.PG_RESTORE_BIN || "pg_restore",
    buildRestoreArgs(dumpPath, listPath, postgresDatabaseName(targetUrl)),
    {
      capture: false,
      databaseUrl: targetUrl,
    },
  );
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
