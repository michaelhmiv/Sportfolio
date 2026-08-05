from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
schema_path = ROOT / "shared/schema.ts"
schema = schema_path.read_text(encoding="utf-8")
anchor = 'export const userApiTokens = pgTable('
block = '// Better Auth tables are deliberately namespaced. Existing `users.id` remains\n// the canonical application/game identity and is linked through authIdentities.\nexport const authUsers = pgTable(\n  "auth_users",\n  {\n    id: varchar("id").primaryKey(),\n    name: text("name").notNull(),\n    email: varchar("email").notNull(),\n    emailVerified: boolean("email_verified").notNull().default(false),\n    image: text("image"),\n    createdAt: timestamp("created_at").notNull().defaultNow(),\n    updatedAt: timestamp("updated_at").notNull().defaultNow(),\n  },\n  (table) => ({\n    emailIdx: uniqueIndex("auth_users_email_idx").on(table.email),\n  }),\n);\n\nexport const authSessions = pgTable(\n  "auth_sessions",\n  {\n    id: varchar("id").primaryKey(),\n    expiresAt: timestamp("expires_at").notNull(),\n    token: text("token").notNull(),\n    createdAt: timestamp("created_at").notNull().defaultNow(),\n    updatedAt: timestamp("updated_at").notNull().defaultNow(),\n    ipAddress: text("ip_address"),\n    userAgent: text("user_agent"),\n    userId: varchar("user_id")\n      .notNull()\n      .references(() => authUsers.id, { onDelete: "cascade" }),\n  },\n  (table) => ({\n    tokenIdx: uniqueIndex("auth_sessions_token_idx").on(table.token),\n    userIdx: index("auth_sessions_user_idx").on(table.userId),\n    expiresIdx: index("auth_sessions_expires_idx").on(table.expiresAt),\n  }),\n);\n\nexport const authAccounts = pgTable(\n  "auth_accounts",\n  {\n    id: varchar("id").primaryKey(),\n    accountId: text("account_id").notNull(),\n    providerId: text("provider_id").notNull(),\n    userId: varchar("user_id")\n      .notNull()\n      .references(() => authUsers.id, { onDelete: "cascade" }),\n    accessToken: text("access_token"),\n    refreshToken: text("refresh_token"),\n    idToken: text("id_token"),\n    accessTokenExpiresAt: timestamp("access_token_expires_at"),\n    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),\n    scope: text("scope"),\n    password: text("password"),\n    createdAt: timestamp("created_at").notNull().defaultNow(),\n    updatedAt: timestamp("updated_at").notNull().defaultNow(),\n  },\n  (table) => ({\n    providerAccountIdx: uniqueIndex("auth_accounts_provider_account_idx").on(\n      table.providerId,\n      table.accountId,\n    ),\n    userIdx: index("auth_accounts_user_idx").on(table.userId),\n  }),\n);\n\nexport const authVerifications = pgTable(\n  "auth_verifications",\n  {\n    id: varchar("id").primaryKey(),\n    identifier: text("identifier").notNull(),\n    value: text("value").notNull(),\n    expiresAt: timestamp("expires_at").notNull(),\n    createdAt: timestamp("created_at").notNull().defaultNow(),\n    updatedAt: timestamp("updated_at").notNull().defaultNow(),\n  },\n  (table) => ({\n    identifierIdx: index("auth_verifications_identifier_idx").on(table.identifier),\n    valueIdx: uniqueIndex("auth_verifications_value_idx").on(table.value),\n    expiresIdx: index("auth_verifications_expires_idx").on(table.expiresAt),\n  }),\n);\n\nexport const authIdentities = pgTable(\n  "auth_identities",\n  {\n    id: varchar("id")\n      .primaryKey()\n      .default(sql`gen_random_uuid()`),\n    authUserId: varchar("auth_user_id")\n      .notNull()\n      .references(() => authUsers.id, { onDelete: "cascade" }),\n    sportfolioUserId: varchar("sportfolio_user_id")\n      .notNull()\n      .references(() => users.id, { onDelete: "restrict" }),\n    provider: text("provider").notNull(),\n    providerSubject: text("provider_subject").notNull(),\n    normalizedEmail: varchar("normalized_email"),\n    originalEmail: varchar("original_email"),\n    verifiedAt: timestamp("verified_at"),\n    linkedAt: timestamp("linked_at").notNull().defaultNow(),\n    metadata: jsonb("metadata")\n      .notNull()\n      .default(sql`\'{}\'::jsonb`),\n  },\n  (table) => ({\n    authUserIdx: uniqueIndex("auth_identities_auth_user_idx").on(table.authUserId),\n    providerSubjectIdx: uniqueIndex("auth_identities_provider_subject_idx").on(\n      table.provider,\n      table.providerSubject,\n    ),\n    sportfolioUserIdx: index("auth_identities_sportfolio_user_idx").on(\n      table.sportfolioUserId,\n    ),\n    emailIdx: index("auth_identities_normalized_email_idx").on(table.normalizedEmail),\n  }),\n);\n\nexport const authMigrationRecords = pgTable(\n  "auth_migration_records",\n  {\n    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),\n    runId: varchar("run_id").notNull(),\n    sourceProvider: text("source_provider").notNull(),\n    sourceSubject: text("source_subject"),\n    normalizedEmail: varchar("normalized_email"),\n    sportfolioUserId: varchar("sportfolio_user_id").references(() => users.id, { onDelete: "set null" }),\n    authUserId: varchar("auth_user_id").references(() => authUsers.id, { onDelete: "set null" }),\n    decision: text("decision").notNull(),\n    conflictCode: text("conflict_code"),\n    details: jsonb("details").notNull().default(sql`\'{}\'::jsonb`),\n    createdAt: timestamp("created_at").notNull().defaultNow(),\n  },\n  (table) => ({\n    runSourceIdx: uniqueIndex("auth_migration_records_run_source_idx").on(table.runId, table.sourceProvider, table.sourceSubject),\n    runIdx: index("auth_migration_records_run_idx").on(table.runId),\n    conflictIdx: index("auth_migration_records_conflict_idx").on(table.conflictCode),\n  }),\n);\n\nexport const authContinuations = pgTable("auth_continuations", {\n  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),\n  purpose: text("purpose").notNull(),\n  destination: text("destination").notNull(),\n  stateHash: varchar("state_hash", { length: 64 }),\n  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),\n  expiresAt: timestamp("expires_at").notNull(),\n  consumedAt: timestamp("consumed_at"),\n  createdAt: timestamp("created_at").notNull().defaultNow(),\n}, (table) => ({ expiryIdx: index("auth_continuations_expiry_idx").on(table.expiresAt), userIdx: index("auth_continuations_user_idx").on(table.userId) }));\n\nexport const authEmailEvents = pgTable("auth_email_events", {\n  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),\n  providerEventId: text("provider_event_id").notNull(),\n  eventType: text("event_type").notNull(),\n  recipientHash: varchar("recipient_hash", { length: 64 }).notNull(),\n  providerMessageId: text("provider_message_id"),\n  occurredAt: timestamp("occurred_at").notNull(),\n  payload: jsonb("payload").notNull().default(sql`\'{}\'::jsonb`),\n  createdAt: timestamp("created_at").notNull().defaultNow(),\n}, (table) => ({ eventIdx: uniqueIndex("auth_email_events_provider_event_idx").on(table.providerEventId), recipientIdx: index("auth_email_events_recipient_idx").on(table.recipientHash) }));\n\nexport const emailSuppressions = pgTable("email_suppressions", {\n  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),\n  emailIdentityHash: varchar("email_identity_hash", { length: 64 }).notNull(),\n  reason: text("reason").notNull(),\n  sourceEventId: text("source_event_id"),\n  suppressedAt: timestamp("suppressed_at").notNull().defaultNow(),\n  liftedAt: timestamp("lifted_at"),\n}, (table) => ({ activeEmailIdx: uniqueIndex("email_suppressions_email_idx").on(table.emailIdentityHash) }));\n\nexport const nativeAuthHandoffs = pgTable("native_auth_handoffs", {\n  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),\n  codeHash: varchar("code_hash", { length: 64 }).notNull(),\n  authUserId: varchar("auth_user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),\n  platform: text("platform").notNull(),\n  requestBindingHash: varchar("request_binding_hash", { length: 64 }),\n  expiresAt: timestamp("expires_at").notNull(),\n  consumedAt: timestamp("consumed_at"),\n  attemptCount: integer("attempt_count").notNull().default(0),\n  createdAt: timestamp("created_at").notNull().defaultNow(),\n}, (table) => ({ codeIdx: uniqueIndex("native_auth_handoffs_code_idx").on(table.codeHash), expiryIdx: index("native_auth_handoffs_expiry_idx").on(table.expiresAt) }));\n\nexport const authSecurityEvents = pgTable("auth_security_events", {\n  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),\n  sportfolioUserId: varchar("sportfolio_user_id").references(() => users.id, { onDelete: "set null" }),\n  authUserId: varchar("auth_user_id").references(() => authUsers.id, { onDelete: "set null" }),\n  eventType: text("event_type").notNull(),\n  outcome: text("outcome").notNull(),\n  requestId: text("request_id"),\n  ipHash: varchar("ip_hash", { length: 64 }),\n  metadata: jsonb("metadata").notNull().default(sql`\'{}\'::jsonb`),\n  createdAt: timestamp("created_at").notNull().defaultNow(),\n}, (table) => ({ typeCreatedIdx: index("auth_security_events_type_created_idx").on(table.eventType, table.createdAt) }));'
if '"auth_users"' not in schema:
    if anchor not in schema:
        raise SystemExit("Could not locate schema insertion anchor")
    schema = schema.replace(anchor, block + "\n\n" + anchor, 1)
schema_path.write_text(schema, encoding="utf-8")

def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")

write("server/auth/identity-policy.ts", '''import { createHash } from "node:crypto";

export type ExistingIdentityTombstone = {
  deletedAt?: Date | null;
  authProviderSubject?: string | null;
  authProviderSubjects?: string[] | null;
  authEmailIdentityHash?: string | null;
};

export function normalizeAuthEmail(email: string): string {
  const normalized = email.trim().normalize("NFKC").toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) throw new Error("A syntactically valid email identity is required.");
  return normalized;
}

export function hashAuthEmailIdentity(email: string): string {
  return createHash("sha256").update(normalizeAuthEmail(email), "utf8").digest("hex");
}

export function assertIdentityIsNotTombstoned(existing: ExistingIdentityTombstone | null | undefined, input: { providerSubject?: string | null; email?: string | null }): void {
  if (!existing) return;
  const subject = input.providerSubject?.trim() || null;
  const emailHash = input.email ? hashAuthEmailIdentity(input.email) : null;
  const subjects = new Set([existing.authProviderSubject, ...(existing.authProviderSubjects ?? [])].filter((value): value is string => Boolean(value)));
  if (existing.deletedAt || (subject && subjects.has(subject)) || (emailHash && existing.authEmailIdentityHash === emailHash)) throw new Error("Identity is blocked by an existing deletion tombstone.");
}
''')
write("server/auth/identity-policy.test.ts", '''import { describe, expect, it } from "vitest";
import { assertIdentityIsNotTombstoned, hashAuthEmailIdentity, normalizeAuthEmail } from "./identity-policy";

describe("authentication identity policy", () => {
  it("normalizes email identities deterministically", () => {
    expect(normalizeAuthEmail("  USER@Example.COM ")).toBe("user@example.com");
    expect(hashAuthEmailIdentity("USER@example.com")).toBe(hashAuthEmailIdentity(" user@EXAMPLE.com "));
  });
  it("rejects malformed identities", () => expect(() => normalizeAuthEmail("not-an-email")).toThrow("syntactically valid email"));
  it("blocks deleted provider subjects and email identities", () => {
    expect(() => assertIdentityIsNotTombstoned({ authProviderSubjects: ["legacy-subject"] }, { providerSubject: "legacy-subject" })).toThrow("deletion tombstone");
    expect(() => assertIdentityIsNotTombstoned({ authEmailIdentityHash: hashAuthEmailIdentity("deleted@example.com") }, { email: "DELETED@example.com" })).toThrow("deletion tombstone");
  });
});
''')
write("server/auth/schema-contract.test.ts", '''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("additive authentication schema contract", () => {
  const schema = readFileSync("shared/schema.ts", "utf8");
  const migration = readFileSync("migrations/0064_passwordless_auth_identity_boundary.sql", "utf8");
  it("keeps users.id canonical", () => {
    expect(schema).toContain('export const users = pgTable(');
    expect(schema).toContain('export const authIdentities = pgTable(');
    expect(schema).toContain('references(() => users.id, { onDelete: "restrict" })');
  });
  it("namespaces Better Auth core tables", () => {
    for (const table of ["auth_users", "auth_sessions", "auth_accounts", "auth_verifications"]) { expect(schema).toContain(`"${table}"`); expect(migration).toContain(`"${table}"`); }
  });
  it("is additive", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS");
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i);
    expect(migration).not.toMatch(/\bALTER\s+TABLE\s+"users"\b/i);
    expect(migration).not.toMatch(/\b(UPDATE|DELETE FROM)\s+"users"\b/i);
  });
});
''')
write("docs/auth/passwordless-auth-schema.md", '''# Passwordless authentication identity schema

This migration is additive and safe for the intentionally shared production database.

- Existing `users.id` remains canonical.
- Better Auth records use namespaced `auth_*` tables.
- `auth_identities` maps Better Auth users to Sportfolio users.
- Tombstones are checked before linking or provisioning.
- Better Auth remains runtime-disabled after merge.
- Beta may not execute this migration.
- Production execution requires the guarded migration workflow, exact confirmation values, and a verified backup.
- Do not use `drizzle-kit push` against the shared production database for this migration.
''')
write("migrations/0064_passwordless_auth_identity_boundary.sql", '''-- Additive passwordless authentication identity boundary.
CREATE TABLE IF NOT EXISTS "auth_users" ("id" varchar PRIMARY KEY NOT NULL, "name" text NOT NULL, "email" varchar NOT NULL, "email_verified" boolean DEFAULT false NOT NULL, "image" text, "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_users_email_idx" ON "auth_users" ("email");
CREATE TABLE IF NOT EXISTS "auth_sessions" ("id" varchar PRIMARY KEY NOT NULL, "expires_at" timestamp NOT NULL, "token" text NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL, "ip_address" text, "user_agent" text, "user_id" varchar NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_token_idx" ON "auth_sessions" ("token");
CREATE TABLE IF NOT EXISTS "auth_accounts" ("id" varchar PRIMARY KEY NOT NULL, "account_id" text NOT NULL, "provider_id" text NOT NULL, "user_id" varchar NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE, "access_token" text, "refresh_token" text, "id_token" text, "access_token_expires_at" timestamp, "refresh_token_expires_at" timestamp, "scope" text, "password" text, "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_accounts_provider_account_idx" ON "auth_accounts" ("provider_id", "account_id");
CREATE TABLE IF NOT EXISTS "auth_verifications" ("id" varchar PRIMARY KEY NOT NULL, "identifier" text NOT NULL, "value" text NOT NULL, "expires_at" timestamp NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_verifications_value_idx" ON "auth_verifications" ("value");
CREATE TABLE IF NOT EXISTS "auth_identities" ("id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "auth_user_id" varchar NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE, "sportfolio_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT, "provider" text NOT NULL, "provider_subject" text NOT NULL, "normalized_email" varchar, "original_email" varchar, "verified_at" timestamp, "linked_at" timestamp DEFAULT now() NOT NULL, "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_identities_auth_user_idx" ON "auth_identities" ("auth_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "auth_identities_provider_subject_idx" ON "auth_identities" ("provider", "provider_subject");
CREATE INDEX IF NOT EXISTS "auth_identities_sportfolio_user_idx" ON "auth_identities" ("sportfolio_user_id");
CREATE TABLE IF NOT EXISTS "auth_migration_records" ("id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "run_id" varchar NOT NULL, "source_provider" text NOT NULL, "source_subject" text, "normalized_email" varchar, "sportfolio_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL, "auth_user_id" varchar REFERENCES "auth_users"("id") ON DELETE SET NULL, "decision" text NOT NULL, "conflict_code" text, "details" jsonb DEFAULT '{}'::jsonb NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_migration_records_run_source_idx" ON "auth_migration_records" ("run_id", "source_provider", "source_subject");
CREATE TABLE IF NOT EXISTS "auth_continuations" ("id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "purpose" text NOT NULL, "destination" text NOT NULL, "state_hash" varchar(64), "user_id" varchar REFERENCES "users"("id") ON DELETE CASCADE, "expires_at" timestamp NOT NULL, "consumed_at" timestamp, "created_at" timestamp DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS "auth_email_events" ("id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "provider_event_id" text NOT NULL, "event_type" text NOT NULL, "recipient_hash" varchar(64) NOT NULL, "provider_message_id" text, "occurred_at" timestamp NOT NULL, "payload" jsonb DEFAULT '{}'::jsonb NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_email_events_provider_event_idx" ON "auth_email_events" ("provider_event_id");
CREATE TABLE IF NOT EXISTS "email_suppressions" ("id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "email_identity_hash" varchar(64) NOT NULL, "reason" text NOT NULL, "source_event_id" text, "suppressed_at" timestamp DEFAULT now() NOT NULL, "lifted_at" timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS "email_suppressions_email_idx" ON "email_suppressions" ("email_identity_hash");
CREATE TABLE IF NOT EXISTS "native_auth_handoffs" ("id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "code_hash" varchar(64) NOT NULL, "auth_user_id" varchar NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE, "platform" text NOT NULL, "request_binding_hash" varchar(64), "expires_at" timestamp NOT NULL, "consumed_at" timestamp, "attempt_count" integer DEFAULT 0 NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "native_auth_handoffs_code_idx" ON "native_auth_handoffs" ("code_hash");
CREATE TABLE IF NOT EXISTS "auth_security_events" ("id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "sportfolio_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL, "auth_user_id" varchar REFERENCES "auth_users"("id") ON DELETE SET NULL, "event_type" text NOT NULL, "outcome" text NOT NULL, "request_id" text, "ip_hash" varchar(64), "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL);
''')
