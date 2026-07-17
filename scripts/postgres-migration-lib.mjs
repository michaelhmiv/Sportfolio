/* global process, URL */
import { lstatSync, mkdirSync, writeFileSync } from "node:fs";

const RLS_TOC_ENTRY = /^\d+;\s+\d+\s+\d+\s+(?:POLICY|ROW SECURITY)\s+/;

export function filterRestoreList(input) {
  const removed = [];
  const kept = [];
  for (const line of input.split("\n")) {
    if (RLS_TOC_ENTRY.test(line)) {
      removed.push(line);
    } else {
      kept.push(line);
    }
  }
  return { content: kept.join("\n"), removed };
}

export function postgresConnectionEnvironment(databaseUrl, baseEnvironment = process.env) {
  const parsed = new URL(databaseUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!parsed.hostname || !database || !parsed.username) {
    throw new Error("database URL must include host, database, and user");
  }
  const environment = {
    ...baseEnvironment,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: database,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
  };
  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode) environment.PGSSLMODE = sslMode;
  return environment;
}

export function buildDumpArgs(dumpPath) {
  return [
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-privileges",
    "--schema=public",
    `--file=${dumpPath}`,
  ];
}

export function postgresDatabaseName(databaseUrl) {
  const database = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  if (!database) throw new Error("database URL must include a database name");
  return database;
}

export function databaseIdentity(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!parsed.hostname || !database) {
    throw new Error("database URL must include a host and database name");
  }
  return `${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}/${database}`;
}

export function assertDifferentDatabases(sourceUrl, targetUrl) {
  if (databaseIdentity(sourceUrl) === databaseIdentity(targetUrl)) {
    throw new Error("source and target database URLs resolve to the same host, port, and database");
  }
}

export function assertNoActiveTargetClients(activeClients) {
  if (!Number.isInteger(activeClients) || activeClients < 0) {
    throw new Error("active target client count must be a non-negative integer");
  }
  if (activeClients > 0) {
    throw new Error(
      `target has ${activeClients} other client connection(s); stop all target users before restore`,
    );
  }
}

export function nonemptyTargetConfirmationToken(targetUrl) {
  return `ERASE ${databaseIdentity(targetUrl)}`;
}

export function assertNonemptyTargetOverride(
  existingObjects,
  targetUrl,
  environment = process.env,
) {
  if (existingObjects === 0) return;
  const token = nonemptyTargetConfirmationToken(targetUrl);
  if (
    environment.ALLOW_NONEMPTY_TARGET !== "true" ||
    environment.CONFIRM_NONEMPTY_TARGET !== token
  ) {
    throw new Error(
      `target public schema has ${existingObjects} object(s); a disposable target requires ALLOW_NONEMPTY_TARGET=true and CONFIRM_NONEMPTY_TARGET=${token}`,
    );
  }
}

function assertOwnedByCurrentUser(stat, label) {
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error(`${label} must be owned by the current user`);
  }
}

export function ensurePrivateArtifactDirectory(directory) {
  try {
    const existing = lstatSync(directory);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(`artifact directory must be a regular directory: ${directory}`);
    }
    assertOwnedByCurrentUser(existing, "artifact directory");
    if ((existing.mode & 0o777) !== 0o700) {
      throw new Error(`artifact directory must have mode 0700: ${directory}`);
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
      throw error;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const created = lstatSync(directory);
    if ((created.mode & 0o777) !== 0o700) {
      throw new Error(`artifact directory must have mode 0700: ${directory}`);
    }
    assertOwnedByCurrentUser(created, "artifact directory");
  }
  return directory;
}

export function assertPrivateArtifactFile(path, label, { nonempty = true } = {}) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file (symlinks are rejected)`);
  }
  assertOwnedByCurrentUser(stat, label);
  if ((stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must have mode 0600`);
  }
  if (nonempty && stat.size === 0) throw new Error(`${label} must be non-empty`);
  return stat;
}

export function writePrivateArtifactFile(path, content) {
  writeFileSync(path, content, { mode: 0o600, flag: "wx" });
  assertPrivateArtifactFile(path, "artifact file", { nonempty: content.length > 0 });
}

export function buildRestoreArgs(dumpPath, listPath, databaseName) {
  return [
    `--dbname=${databaseName}`,
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    "--single-transaction",
    `--use-list=${listPath}`,
    dumpPath,
  ];
}

export const STRUCTURAL_DEFINITIONS_SQL = `WITH definitions(object_key, definition) AS (
  SELECT 'columns/' || table_name || '.' || column_name,
    format('%s|%s|%s|%s', udt_schema || '.' || udt_name, is_nullable,
      COALESCE(column_default, ''), COALESCE(identity_generation, ''))
  FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL
  SELECT 'constraints/' ||
      CASE WHEN con.conrelid = 0 THEN format_type(con.contypid, NULL)
           ELSE con.conrelid::regclass::text END || '.' || con.conname,
    format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s', con.contype,
      (SELECT array_agg(a.attname ORDER BY keys.ordinality)
         FROM unnest(con.conkey) WITH ORDINALITY keys(attnum, ordinality)
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = keys.attnum),
      con.confrelid::regclass::text,
      (SELECT array_agg(a.attname ORDER BY keys.ordinality)
         FROM unnest(con.confkey) WITH ORDINALITY keys(attnum, ordinality)
         JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = keys.attnum),
      con.confupdtype, con.confdeltype, con.confmatchtype, con.condeferrable,
      con.condeferred, con.convalidated,
      CASE WHEN con.contype = 'c' THEN pg_get_expr(con.conbin, con.conrelid, false) ELSE '' END)
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
  SELECT 'sequences/' || c.relname,
    format('%s|%s|%s|%s|%s|%s|%s', format_type(s.seqtypid, NULL), s.seqstart,
      s.seqmin, s.seqmax, s.seqincrement, s.seqcycle, s.seqcache)
  FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'sequence-ownership/' || seq.relname,
    COALESCE(owner.relname || '.' || attr.attname || '|' || dep.deptype, '')
  FROM pg_class seq JOIN pg_namespace n ON n.oid = seq.relnamespace
  LEFT JOIN pg_depend dep ON dep.classid = 'pg_class'::regclass AND dep.objid = seq.oid
    AND dep.objsubid = 0 AND dep.refclassid = 'pg_class'::regclass AND dep.deptype IN ('a', 'i')
  LEFT JOIN pg_class owner ON owner.oid = dep.refobjid
  LEFT JOIN pg_attribute attr ON attr.attrelid = dep.refobjid AND attr.attnum = dep.refobjsubid
  WHERE n.nspname = 'public' AND seq.relkind = 'S'
  UNION ALL
  SELECT 'types/enum/' || t.typname,
    string_agg(e.enumlabel, '|' ORDER BY e.enumsortorder)
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public' GROUP BY t.oid, t.typname
  UNION ALL
  SELECT 'types/domain/' || t.typname,
    format('%s|%s|%s|%s', format_type(t.typbasetype, t.typtypmod), t.typnotnull,
      COALESCE(pg_get_expr(t.typdefaultbin, 0, false), t.typdefault, ''),
      COALESCE(coll.collname, ''))
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  LEFT JOIN pg_collation coll ON coll.oid = t.typcollation
  WHERE n.nspname = 'public' AND t.typtype = 'd'
  UNION ALL
  SELECT 'types/composite/' || t.typname,
    string_agg(format('%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull),
      '|' ORDER BY a.attnum)
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_class c ON c.oid = t.typrelid AND c.relkind = 'c'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE n.nspname = 'public' GROUP BY t.oid, t.typname
  UNION ALL
  SELECT 'types/range/' || t.typname,
    format('%s|%s|%s|%s', format_type(r.rngsubtype, NULL), r.rngcollation,
      r.rngcanonical::regprocedure::text, r.rngsubdiff::regprocedure::text)
  FROM pg_range r JOIN pg_type t ON t.oid = r.rngtypid
  JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'relations/' || c.relname, format('%s|%s|%s', c.relkind, c.relpersistence,
    COALESCE(pg_get_partkeydef(c.oid), ''))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
)
SELECT object_key, md5(definition) FROM definitions ORDER BY object_key;
`;

export const SEQUENCE_VALUES_SQL = `SELECT format(
  'SELECT %L AS object_key, md5(format(''%%s|%%s'', last_value, is_called)) AS fingerprint FROM %I.%I;',
  'sequence-values/' || c.relname, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'
ORDER BY c.relname
\\gexec
`;

function assertCountRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const [key, count] of Object.entries(value)) {
    if (!key || !Number.isInteger(count) || count < 0) {
      throw new Error(`${label}.${key} must be a non-negative integer`);
    }
  }
}

export function parseVerificationInventory(json) {
  const value = JSON.parse(json);
  assertCountRecord(value.tables, "tables");
  assertCountRecord(value.objects, "objects");
  if (
    !value.definitions ||
    typeof value.definitions !== "object" ||
    Array.isArray(value.definitions)
  ) {
    throw new Error("definitions must be an object");
  }
  for (const [key, hash] of Object.entries(value.definitions)) {
    if (!key || typeof hash !== "string" || !/^[a-f0-9]{32}$/.test(hash)) {
      throw new Error(`definitions.${key} must be an md5 fingerprint`);
    }
  }
  for (const key of [
    "invalidForeignKeys",
    "policies",
    "rowSecurityTables",
    "authFunctionReferences",
  ]) {
    if (!Number.isInteger(value[key]) || value[key] < 0) {
      throw new Error(`${key} must be a non-negative integer`);
    }
  }
  return value;
}

export function verifyInventoryParity(source, target) {
  const errors = [];
  const tableNames = new Set([...Object.keys(source.tables), ...Object.keys(target.tables)]);
  for (const table of [...tableNames].sort()) {
    const sourceCount = source.tables[table];
    const targetCount = target.tables[table];
    if (sourceCount !== targetCount) {
      errors.push(
        `row count mismatch for ${table}: source=${sourceCount ?? "missing"} target=${targetCount ?? "missing"}`,
      );
    }
  }

  const objectKinds = new Set([...Object.keys(source.objects), ...Object.keys(target.objects)]);
  for (const kind of [...objectKinds].sort()) {
    const sourceCount = source.objects[kind];
    const targetCount = target.objects[kind];
    if (sourceCount !== targetCount) {
      errors.push(
        `object count mismatch for ${kind}: source=${sourceCount ?? "missing"} target=${targetCount ?? "missing"}`,
      );
    }
  }

  const definitionKinds = new Set([
    ...Object.keys(source.definitions),
    ...Object.keys(target.definitions),
  ]);
  for (const kind of [...definitionKinds].sort()) {
    if (source.definitions[kind] !== target.definitions[kind]) {
      errors.push(`definition mismatch for ${kind}`);
    }
  }

  if (target.invalidForeignKeys !== 0) {
    errors.push(`target has ${target.invalidForeignKeys} invalid foreign key(s)`);
  }
  if (target.policies !== 0) {
    errors.push(`target still has ${target.policies} RLS policy/policies`);
  }
  if (target.rowSecurityTables !== 0) {
    errors.push(`target still has row security enabled on ${target.rowSecurityTables} table(s)`);
  }
  if (target.authFunctionReferences !== 0) {
    errors.push(
      `target has ${target.authFunctionReferences} public function(s) referencing auth.*`,
    );
  }

  return errors;
}
