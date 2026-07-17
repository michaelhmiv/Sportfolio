/* global process, URL */
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
