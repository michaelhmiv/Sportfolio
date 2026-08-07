from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

schema_path = ROOT / "shared/schema.ts"
schema = schema_path.read_text(encoding="utf-8")
anchor = "export const authIdentities = pgTable("
if "export const authOauthClients" not in schema:
    block = r'''export const authOauthClients = pgTable(
  "auth_oauth_clients",
  {
    id: varchar("id").primaryKey(),
    clientId: varchar("client_id").notNull(),
    clientSecret: text("client_secret"),
    disabled: boolean("disabled").default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    userId: varchar("user_id").references(() => authUsers.id, { onDelete: "cascade" }),
    referenceId: varchar("reference_id"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    public: boolean("public"),
    type: text("type"),
    requirePKCE: boolean("require_pkce"),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    clientIdIdx: uniqueIndex("auth_oauth_clients_client_id_idx").on(table.clientId),
    userIdx: index("auth_oauth_clients_user_idx").on(table.userId),
  }),
);

export const authOauthRefreshTokens = pgTable(
  "auth_oauth_refresh_tokens",
  {
    id: varchar("id").primaryKey(),
    token: text("token").notNull(),
    clientId: varchar("client_id")
      .notNull()
      .references(() => authOauthClients.clientId, { onDelete: "cascade" }),
    sessionId: varchar("session_id").references(() => authSessions.id, { onDelete: "set null" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    referenceId: varchar("reference_id"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    revoked: timestamp("revoked"),
    authTime: timestamp("auth_time"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => ({
    tokenIdx: uniqueIndex("auth_oauth_refresh_tokens_token_idx").on(table.token),
    clientIdx: index("auth_oauth_refresh_tokens_client_idx").on(table.clientId),
    sessionIdx: index("auth_oauth_refresh_tokens_session_idx").on(table.sessionId),
    userIdx: index("auth_oauth_refresh_tokens_user_idx").on(table.userId),
  }),
);

export const authOauthAccessTokens = pgTable(
  "auth_oauth_access_tokens",
  {
    id: varchar("id").primaryKey(),
    token: text("token").notNull(),
    clientId: varchar("client_id")
      .notNull()
      .references(() => authOauthClients.clientId, { onDelete: "cascade" }),
    sessionId: varchar("session_id").references(() => authSessions.id, { onDelete: "set null" }),
    refreshId: varchar("refresh_id").references(() => authOauthRefreshTokens.id, {
      onDelete: "set null",
    }),
    userId: varchar("user_id").references(() => authUsers.id, { onDelete: "cascade" }),
    referenceId: varchar("reference_id"),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    tokenIdx: uniqueIndex("auth_oauth_access_tokens_token_idx").on(table.token),
    clientIdx: index("auth_oauth_access_tokens_client_idx").on(table.clientId),
    sessionIdx: index("auth_oauth_access_tokens_session_idx").on(table.sessionId),
    refreshIdx: index("auth_oauth_access_tokens_refresh_idx").on(table.refreshId),
    userIdx: index("auth_oauth_access_tokens_user_idx").on(table.userId),
  }),
);

export const authOauthConsents = pgTable(
  "auth_oauth_consents",
  {
    id: varchar("id").primaryKey(),
    userId: varchar("user_id").references(() => authUsers.id, { onDelete: "cascade" }),
    clientId: varchar("client_id")
      .notNull()
      .references(() => authOauthClients.clientId, { onDelete: "cascade" }),
    referenceId: varchar("reference_id"),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => ({
    clientIdx: index("auth_oauth_consents_client_idx").on(table.clientId),
    userIdx: index("auth_oauth_consents_user_idx").on(table.userId),
  }),
);

export const authJwks = pgTable("auth_jwks", {
  id: varchar("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at"),
});

'''
    schema = schema.replace(anchor, block + anchor, 1)
    schema_path.write_text(schema, encoding="utf-8")

migration = r'''-- Better Auth OAuth 2.1 provider + JWT/JWKS schema (pinned runtime 1.6.25).
CREATE TABLE IF NOT EXISTS "auth_oauth_clients" (
  "id" varchar PRIMARY KEY NOT NULL,
  "client_id" varchar NOT NULL,
  "client_secret" text,
  "disabled" boolean DEFAULT false,
  "skip_consent" boolean,
  "enable_end_session" boolean,
  "subject_type" text,
  "scopes" text[],
  "user_id" varchar REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "reference_id" varchar,
  "created_at" timestamp,
  "updated_at" timestamp,
  "name" text,
  "uri" text,
  "icon" text,
  "contacts" text[],
  "tos" text,
  "policy" text,
  "software_id" text,
  "software_version" text,
  "software_statement" text,
  "redirect_uris" text[] NOT NULL,
  "post_logout_redirect_uris" text[],
  "token_endpoint_auth_method" text,
  "grant_types" text[],
  "response_types" text[],
  "public" boolean,
  "type" text,
  "require_pkce" boolean,
  "metadata" jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_oauth_clients_client_id_idx" ON "auth_oauth_clients" ("client_id");
CREATE INDEX IF NOT EXISTS "auth_oauth_clients_user_idx" ON "auth_oauth_clients" ("user_id");

CREATE TABLE IF NOT EXISTS "auth_oauth_refresh_tokens" (
  "id" varchar PRIMARY KEY NOT NULL,
  "token" text NOT NULL,
  "client_id" varchar NOT NULL REFERENCES "auth_oauth_clients"("client_id") ON DELETE CASCADE,
  "session_id" varchar REFERENCES "auth_sessions"("id") ON DELETE SET NULL,
  "user_id" varchar NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "reference_id" varchar,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL,
  "revoked" timestamp,
  "auth_time" timestamp,
  "scopes" text[] NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_oauth_refresh_tokens_token_idx" ON "auth_oauth_refresh_tokens" ("token");
CREATE INDEX IF NOT EXISTS "auth_oauth_refresh_tokens_client_idx" ON "auth_oauth_refresh_tokens" ("client_id");
CREATE INDEX IF NOT EXISTS "auth_oauth_refresh_tokens_session_idx" ON "auth_oauth_refresh_tokens" ("session_id");
CREATE INDEX IF NOT EXISTS "auth_oauth_refresh_tokens_user_idx" ON "auth_oauth_refresh_tokens" ("user_id");

CREATE TABLE IF NOT EXISTS "auth_oauth_access_tokens" (
  "id" varchar PRIMARY KEY NOT NULL,
  "token" text NOT NULL,
  "client_id" varchar NOT NULL REFERENCES "auth_oauth_clients"("client_id") ON DELETE CASCADE,
  "session_id" varchar REFERENCES "auth_sessions"("id") ON DELETE SET NULL,
  "refresh_id" varchar REFERENCES "auth_oauth_refresh_tokens"("id") ON DELETE SET NULL,
  "user_id" varchar REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "reference_id" varchar,
  "scopes" text[] NOT NULL,
  "created_at" timestamp NOT NULL,
  "expires_at" timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_oauth_access_tokens_token_idx" ON "auth_oauth_access_tokens" ("token");
CREATE INDEX IF NOT EXISTS "auth_oauth_access_tokens_client_idx" ON "auth_oauth_access_tokens" ("client_id");
CREATE INDEX IF NOT EXISTS "auth_oauth_access_tokens_session_idx" ON "auth_oauth_access_tokens" ("session_id");
CREATE INDEX IF NOT EXISTS "auth_oauth_access_tokens_refresh_idx" ON "auth_oauth_access_tokens" ("refresh_id");
CREATE INDEX IF NOT EXISTS "auth_oauth_access_tokens_user_idx" ON "auth_oauth_access_tokens" ("user_id");

CREATE TABLE IF NOT EXISTS "auth_oauth_consents" (
  "id" varchar PRIMARY KEY NOT NULL,
  "user_id" varchar REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "client_id" varchar NOT NULL REFERENCES "auth_oauth_clients"("client_id") ON DELETE CASCADE,
  "reference_id" varchar,
  "scopes" text[] NOT NULL,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "auth_oauth_consents_client_idx" ON "auth_oauth_consents" ("client_id");
CREATE INDEX IF NOT EXISTS "auth_oauth_consents_user_idx" ON "auth_oauth_consents" ("user_id");

CREATE TABLE IF NOT EXISTS "auth_jwks" (
  "id" varchar PRIMARY KEY NOT NULL,
  "public_key" text NOT NULL,
  "private_key" text NOT NULL,
  "created_at" timestamp NOT NULL,
  "expires_at" timestamp
);
'''
(ROOT / "migrations/0065_better_auth_oauth_provider.sql").write_text(migration, encoding="utf-8")

ensure_path = ROOT / "server/auth/ensure-auth-schema.ts"
ensure = ensure_path.read_text(encoding="utf-8")
ensure = ensure.replace(
    'const AUTH_SCHEMA_MIGRATION = "migrations/0064_passwordless_auth_identity_boundary.sql";',
    'const AUTH_SCHEMA_MIGRATIONS = [\n  "migrations/0064_passwordless_auth_identity_boundary.sql",\n  "migrations/0065_better_auth_oauth_provider.sql",\n] as const;',
)
ensure = ensure.replace(
    '  const migrationPath = path.resolve(process.cwd(), AUTH_SCHEMA_MIGRATION);\n  const migrationSql = await readFile(migrationPath, "utf8");',
    '  const migrations = await Promise.all(\n    AUTH_SCHEMA_MIGRATIONS.map(async (migration) =>\n      readFile(path.resolve(process.cwd(), migration), "utf8"),\n    ),\n  );',
)
ensure = ensure.replace(
    '    await client.query(migrationSql);',
    '    for (const migrationSql of migrations) await client.query(migrationSql);',
)
ensure_path.write_text(ensure, encoding="utf-8")
