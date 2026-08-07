from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
schema_path = ROOT / "shared/schema.ts"
schema = schema_path.read_text(encoding="utf-8")
anchor = 'export const authSecurityEvents = pgTable('
if 'export const nativeAuthSessions = pgTable(' not in schema:
    block = r'''export const nativeAuthSessions = pgTable(
  "native_auth_sessions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    authUserId: varchar("auth_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    sportfolioUserId: varchar("sportfolio_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    tokenIdx: uniqueIndex("native_auth_sessions_token_idx").on(table.tokenHash),
    userIdx: index("native_auth_sessions_user_idx").on(table.sportfolioUserId),
    expiryIdx: index("native_auth_sessions_expiry_idx").on(table.expiresAt),
  }),
);

'''
    if anchor not in schema:
        raise SystemExit('native auth schema anchor missing')
    schema = schema.replace(anchor, block + anchor, 1)
    schema_path.write_text(schema, encoding='utf-8')

migration = r'''-- Native passwordless handoff bearer sessions.
CREATE TABLE IF NOT EXISTS "native_auth_sessions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "token_hash" varchar(64) NOT NULL,
  "auth_user_id" varchar NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "sportfolio_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "platform" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "last_used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "native_auth_sessions_token_idx" ON "native_auth_sessions" ("token_hash");
CREATE INDEX IF NOT EXISTS "native_auth_sessions_user_idx" ON "native_auth_sessions" ("sportfolio_user_id");
CREATE INDEX IF NOT EXISTS "native_auth_sessions_expiry_idx" ON "native_auth_sessions" ("expires_at");
'''
(ROOT / 'migrations/0066_native_passwordless_sessions.sql').write_text(migration, encoding='utf-8')

ensure_path = ROOT / 'server/auth/ensure-auth-schema.ts'
ensure = ensure_path.read_text(encoding='utf-8')
needle = '  "migrations/0065_better_auth_oauth_provider.sql",\n] as const;'
replacement = '  "migrations/0065_better_auth_oauth_provider.sql",\n  "migrations/0066_native_passwordless_sessions.sql",\n] as const;'
if needle not in ensure:
    raise SystemExit('auth migration list anchor missing')
ensure = ensure.replace(needle, replacement, 1)
ensure_path.write_text(ensure, encoding='utf-8')
