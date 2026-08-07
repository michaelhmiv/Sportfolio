import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  decimal,
  integer,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  check,
  foreignKey,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (for optional session-backed auth flows)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table - core user account
export const users = pgTable(
  "users",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Auth provider fields. Retained on soft deletion as an identity tombstone so
    // surviving provider credentials cannot recreate an erased account.
    authProviderSubject: varchar("auth_provider_subject").unique(),
    authProviderSubjects: text("auth_provider_subjects")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    authEmailIdentityHash: varchar("auth_email_identity_hash", { length: 64 }).unique(),
    email: varchar("email").unique(),
    firstName: varchar("first_name"),
    lastName: varchar("last_name"),
    profileImageUrl: varchar("profile_image_url"),
    // App-specific fields
    username: text("username").unique(), // Optional username, defaults to email
    balance: decimal("balance", { precision: 20, scale: 2 }).notNull().default("10000.00"), // Starting balance: $10,000
    isAdmin: boolean("is_admin").notNull().default(false), // Admin access to system management
    isPremium: boolean("is_premium").notNull().default(false),
    premiumExpiresAt: timestamp("premium_expires_at"),
    hasSeenOnboarding: boolean("has_seen_onboarding").notNull().default(false), // Track if user completed onboarding
    isBot: boolean("is_bot").notNull().default(false), // True for market maker bot accounts
    profileVisibility: varchar("profile_visibility", { length: 10 }).notNull().default("public"),
    // Profile stats
    totalSharesVested: integer("total_shares_vested").notNull().default(0),
    totalMarketOrders: integer("total_market_orders").notNull().default(0),
    totalTradesExecuted: integer("total_trades_executed").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // News Hub fields
    lastNewsViewedAt: timestamp("last_news_viewed_at"), // Track when user last viewed news
    newsNotificationsEnabled: boolean("news_notifications_enabled").notNull().default(true), // Opt-out of news notifications
    // Scout Engine fields
    lastActiveAt: timestamp("last_active_at"), // Scout Engine: activity tracking for 24h kill-switch
    deletedAt: timestamp("deleted_at"), // Set when account deletion has been processed
  },
  (table) => ({
    lastActiveIdx: index("users_last_active_idx").on(table.lastActiveAt),
    visibilityIdx: index("users_profile_visibility_idx").on(table.profileVisibility),
    visibilityCheck: check(
      "users_profile_visibility_check",
      sql`${table.profileVisibility} IN ('public', 'private')`,
    ),
  }),
);

// Better Auth tables are deliberately namespaced. Existing `users.id` remains
// the canonical application/game identity and is linked through authIdentities.
export const authUsers = pgTable(
  "auth_users",
  {
    id: varchar("id").primaryKey(),
    name: text("name").notNull(),
    email: varchar("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({ emailIdx: uniqueIndex("auth_users_email_idx").on(table.email) }),
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: varchar("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: varchar("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (table) => ({
    tokenIdx: uniqueIndex("auth_sessions_token_idx").on(table.token),
    userIdx: index("auth_sessions_user_idx").on(table.userId),
    expiresIdx: index("auth_sessions_expires_idx").on(table.expiresAt),
  }),
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: varchar("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: varchar("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    providerAccountIdx: uniqueIndex("auth_accounts_provider_account_idx").on(
      table.providerId,
      table.accountId,
    ),
    userIdx: index("auth_accounts_user_idx").on(table.userId),
  }),
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: varchar("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    identifierIdx: index("auth_verifications_identifier_idx").on(table.identifier),
    valueIdx: uniqueIndex("auth_verifications_value_idx").on(table.value),
    expiresIdx: index("auth_verifications_expires_idx").on(table.expiresAt),
  }),
);

export const authOauthClients = pgTable(
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

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    authUserId: varchar("auth_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    sportfolioUserId: varchar("sportfolio_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    normalizedEmail: varchar("normalized_email"),
    originalEmail: varchar("original_email"),
    verifiedAt: timestamp("verified_at"),
    linkedAt: timestamp("linked_at").notNull().defaultNow(),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => ({
    authUserIdx: uniqueIndex("auth_identities_auth_user_idx").on(table.authUserId),
    providerSubjectIdx: uniqueIndex("auth_identities_provider_subject_idx").on(
      table.provider,
      table.providerSubject,
    ),
    sportfolioUserIdx: index("auth_identities_sportfolio_user_idx").on(table.sportfolioUserId),
    emailIdx: index("auth_identities_normalized_email_idx").on(table.normalizedEmail),
  }),
);

export const authMigrationRecords = pgTable(
  "auth_migration_records",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    runId: varchar("run_id").notNull(),
    sourceProvider: text("source_provider").notNull(),
    sourceSubject: text("source_subject"),
    normalizedEmail: varchar("normalized_email"),
    sportfolioUserId: varchar("sportfolio_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    authUserId: varchar("auth_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    decision: text("decision").notNull(),
    conflictCode: text("conflict_code"),
    details: jsonb("details")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    runSourceIdx: uniqueIndex("auth_migration_records_run_source_idx").on(
      table.runId,
      table.sourceProvider,
      table.sourceSubject,
    ),
    runIdx: index("auth_migration_records_run_idx").on(table.runId),
    conflictIdx: index("auth_migration_records_conflict_idx").on(table.conflictCode),
  }),
);

export const authContinuations = pgTable(
  "auth_continuations",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    purpose: text("purpose").notNull(),
    destination: text("destination").notNull(),
    stateHash: varchar("state_hash", { length: 64 }),
    userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    expiryIdx: index("auth_continuations_expiry_idx").on(table.expiresAt),
    userIdx: index("auth_continuations_user_idx").on(table.userId),
  }),
);

export const authEmailEvents = pgTable(
  "auth_email_events",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    recipientHash: varchar("recipient_hash", { length: 64 }).notNull(),
    providerMessageId: text("provider_message_id"),
    occurredAt: timestamp("occurred_at").notNull(),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    eventIdx: uniqueIndex("auth_email_events_provider_event_idx").on(table.providerEventId),
    recipientIdx: index("auth_email_events_recipient_idx").on(table.recipientHash),
  }),
);

export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    emailIdentityHash: varchar("email_identity_hash", { length: 64 }).notNull(),
    reason: text("reason").notNull(),
    sourceEventId: text("source_event_id"),
    suppressedAt: timestamp("suppressed_at").notNull().defaultNow(),
    liftedAt: timestamp("lifted_at"),
  },
  (table) => ({
    emailIdx: uniqueIndex("email_suppressions_email_idx").on(table.emailIdentityHash),
  }),
);

export const nativeAuthHandoffs = pgTable(
  "native_auth_handoffs",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    authUserId: varchar("auth_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    requestBindingHash: varchar("request_binding_hash", { length: 64 }),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    codeIdx: uniqueIndex("native_auth_handoffs_code_idx").on(table.codeHash),
    expiryIdx: index("native_auth_handoffs_expiry_idx").on(table.expiresAt),
  }),
);

export const nativeAuthSessions = pgTable(
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

export const authSecurityEvents = pgTable(
  "auth_security_events",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sportfolioUserId: varchar("sportfolio_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    authUserId: varchar("auth_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    outcome: text("outcome").notNull(),
    requestId: text("request_id"),
    ipHash: varchar("ip_hash", { length: 64 }),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    typeCreatedIdx: index("auth_security_events_type_created_idx").on(
      table.eventType,
      table.createdAt,
    ),
  }),
);

export const userApiTokens = pgTable(
  "user_api_tokens",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: varchar("token_prefix", { length: 32 }).notNull(),
    tokenLast4: varchar("token_last4", { length: 4 }).notNull(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("user_api_tokens_user_idx").on(table.userId),
    hashIdx: uniqueIndex("user_api_tokens_hash_idx").on(table.tokenHash),
    activeIdx: index("user_api_tokens_active_idx").on(table.userId, table.revokedAt),
  }),
);

export const userPushTokens = pgTable(
  "user_push_tokens",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull().default("android"),
    token: text("token").notNull(),
    deviceId: text("device_id"),
    appVersion: text("app_version"),
    osVersion: text("os_version"),
    deviceModel: text("device_model"),
    isActive: boolean("is_active").notNull().default(true),
    lastRegisteredAt: timestamp("last_registered_at").notNull().defaultNow(),
    lastSuccessfulAt: timestamp("last_successful_at"),
    lastFailureAt: timestamp("last_failure_at"),
    failureCount: integer("failure_count").notNull().default(0),
    lastError: text("last_error"),
    invalidatedAt: timestamp("invalidated_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("user_push_tokens_user_idx").on(table.userId),
    userPlatformActiveIdx: index("user_push_tokens_user_platform_active_idx").on(
      table.userId,
      table.platform,
      table.isActive,
    ),
    tokenIdx: uniqueIndex("user_push_tokens_token_idx").on(table.token),
    deviceIdx: index("user_push_tokens_device_idx").on(
      table.userId,
      table.platform,
      table.deviceId,
    ),
  }),
);

export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notificationType: text("notification_type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userTypeIdx: uniqueIndex("user_notification_prefs_user_type_idx").on(
      table.userId,
      table.notificationType,
    ),
    userIdx: index("user_notification_prefs_user_idx").on(table.userId),
  }),
);

export const pushNotificationEvents = pgTable(
  "push_notification_events",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notificationType: text("notification_type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    route: text("route").notNull().default("/"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    deliveryStatus: text("delivery_status").notNull().default("pending"),
    provider: text("provider").notNull().default("firebase"),
    providerMessageId: text("provider_message_id"),
    dedupeKey: text("dedupe_key"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index("push_notification_events_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    typeCreatedIdx: index("push_notification_events_type_created_idx").on(
      table.notificationType,
      table.createdAt,
    ),
    statusIdx: index("push_notification_events_status_idx").on(table.deliveryStatus),
    userDedupeIdx: uniqueIndex("push_notification_events_user_dedupe_idx").on(
      table.userId,
      table.dedupeKey,
    ),
  }),
);

export const userNotificationSettings = pgTable(
  "user_notification_settings",
  {
    userId: varchar("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    pushEnabled: boolean("push_enabled").notNull().default(true),
    categoryPreferences: jsonb("category_preferences")
      .$type<Record<string, boolean>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pushEnabledIdx: index("user_notification_settings_push_enabled_idx").on(table.pushEnabled),
    updatedAtIdx: index("user_notification_settings_updated_at_idx").on(table.updatedAt),
  }),
);

export const userPushDevices = pgTable(
  "user_push_devices",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull().default("android"),
    token: text("token").notNull(),
    deviceId: varchar("device_id", { length: 128 }),
    appVersion: varchar("app_version", { length: 64 }),
    permissionStatus: text("permission_status").notNull().default("unknown"),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    enabled: boolean("enabled").notNull().default(true),
    invalidatedAt: timestamp("invalidated_at"),
    invalidReason: text("invalid_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tokenIdx: uniqueIndex("user_push_devices_token_idx").on(table.token),
    userIdx: index("user_push_devices_user_idx").on(table.userId),
    userEnabledIdx: index("user_push_devices_user_enabled_idx").on(
      table.userId,
      table.enabled,
      table.invalidatedAt,
    ),
    deviceIdx: index("user_push_devices_device_idx").on(table.deviceId),
    permissionIdx: index("user_push_devices_permission_idx").on(table.permissionStatus),
  }),
);

export const accountDeletionRequests = pgTable(
  "account_deletion_requests",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // pending | cancelled | processing | completed | failed
    reason: text("reason"),
    details: text("details"),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    effectiveAt: timestamp("effective_at").notNull(),
    cancelledAt: timestamp("cancelled_at"),
    processedAt: timestamp("processed_at"),
    retainedRecordsNote: text("retained_records_note"),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => ({
    userStatusIdx: index("account_deletion_requests_user_status_idx").on(
      table.userId,
      table.status,
    ),
    effectiveIdx: index("account_deletion_requests_effective_idx").on(
      table.status,
      table.effectiveAt,
    ),
    requestedIdx: index("account_deletion_requests_requested_idx").on(table.requestedAt),
  }),
);

export const discordUserLinks = pgTable(
  "discord_user_links",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    discordUserId: varchar("discord_user_id", { length: 32 }).notNull(),
    discordUsername: text("discord_username"),
    discordGlobalName: text("discord_global_name"),
    guildId: varchar("guild_id", { length: 32 }),
    linkedAt: timestamp("linked_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: uniqueIndex("discord_user_links_user_idx").on(table.userId),
    discordUserIdx: uniqueIndex("discord_user_links_discord_user_idx").on(table.discordUserId),
    guildIdx: index("discord_user_links_guild_idx").on(table.guildId),
  }),
);

export const discordLinkStates = pgTable(
  "discord_link_states",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    stateHash: text("state_hash").notNull(),
    discordUserId: varchar("discord_user_id", { length: 32 }).notNull(),
    discordUsername: text("discord_username"),
    discordGlobalName: text("discord_global_name"),
    guildId: varchar("guild_id", { length: 32 }),
    channelId: varchar("channel_id", { length: 32 }),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    hashIdx: uniqueIndex("discord_link_states_hash_idx").on(table.stateHash),
    userIdx: index("discord_link_states_discord_user_idx").on(table.discordUserId),
    expiryIdx: index("discord_link_states_expiry_idx").on(table.expiresAt),
  }),
);

export const discordTradeIntents = pgTable(
  "discord_trade_intents",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    discordUserId: varchar("discord_user_id", { length: 32 }).notNull(),
    guildId: varchar("guild_id", { length: 32 }),
    commandType: text("command_type").notNull(), // buy | sell
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    amount: decimal("amount", { precision: 20, scale: 6 }).notNull(),
    maxSlippage: decimal("max_slippage", { precision: 12, scale: 6 }),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("discord_trade_intents_user_idx").on(table.userId, table.createdAt),
    discordUserIdx: index("discord_trade_intents_discord_user_idx").on(
      table.discordUserId,
      table.createdAt,
    ),
    expiryIdx: index("discord_trade_intents_expiry_idx").on(table.expiresAt),
  }),
);

export const discordPostHistory = pgTable(
  "discord_post_history",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    channelId: varchar("channel_id", { length: 32 }).notNull(),
    sourceType: text("source_type").notNull(), // news | hourly_digest
    sourceKey: text("source_key").notNull(),
    discordMessageId: varchar("discord_message_id", { length: 32 }),
    postedAt: timestamp("posted_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    dedupeIdx: uniqueIndex("discord_post_history_dedupe_idx").on(
      table.channelId,
      table.sourceType,
      table.sourceKey,
    ),
    sourceIdx: index("discord_post_history_source_idx").on(table.sourceType, table.createdAt),
  }),
);

export const discordReportSyncs = pgTable(
  "discord_report_syncs",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    threadChannelId: varchar("thread_channel_id", { length: 32 }).notNull(),
    parentChannelId: varchar("parent_channel_id", { length: 32 }).notNull(),
    reportType: text("report_type").notNull(), // bug | feature
    threadName: text("thread_name"),
    githubOwner: text("github_owner").notNull(),
    githubRepo: text("github_repo").notNull(),
    githubIssueNumber: integer("github_issue_number").notNull(),
    githubIssueUrl: text("github_issue_url").notNull(),
    createdByDiscordUserId: varchar("created_by_discord_user_id", { length: 32 }),
    lastSyncedMessageId: varchar("last_synced_message_id", { length: 32 }),
    lastSyncedAt: timestamp("last_synced_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    threadIdx: uniqueIndex("discord_report_syncs_thread_idx").on(table.threadChannelId),
    issueIdx: uniqueIndex("discord_report_syncs_issue_idx").on(
      table.githubOwner,
      table.githubRepo,
      table.githubIssueNumber,
    ),
    reportTypeIdx: index("discord_report_syncs_type_idx").on(table.reportType, table.createdAt),
  }),
);

// Players table - players from all sports (NBA, NFL, etc.)
// Player IDs are prefixed with sport: nba_12345, nfl_67890
export const players = pgTable(
  "players",
  {
    id: varchar("id").primaryKey(), // Prefixed player ID (e.g., nba_12345, nfl_67890)
    sport: text("sport").notNull().default("NBA"), // NBA, NFL, etc.
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    team: text("team").notNull(),
    position: text("position").notNull(),
    jerseyNumber: text("jersey_number"),
    isActive: boolean("is_active").notNull().default(true), // On active roster
    isEligibleForVesting: boolean("is_eligible_for_vesting").notNull().default(true),
    currentPrice: decimal("current_price", { precision: 10, scale: 2 }).notNull().default("0.00"), // Starts at 0 until user liquidity initializes a pool
    lastTradePrice: decimal("last_trade_price", { precision: 10, scale: 2 }), // Actual market price from last trade, null if no trades
    volume24h: integer("volume_24h").notNull().default(0),
    priceChange24h: decimal("price_change_24h", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    marketCap: decimal("market_cap", { precision: 20, scale: 2 }).notNull().default("0.00"), // Total shares * price, updated on each trade
    totalShares: integer("total_shares").notNull().default(0), // Total shares held by all users, updated on each trade
    lastUpdated: timestamp("last_updated").notNull().defaultNow(),
    // Injury tracking fields
    injuryStatus: text("injury_status"), // "Out", "Doubtful", "Questionable", "Probable", "Day-To-Day", null = healthy
    injuryDescription: text("injury_description"), // Full injury details
    injuryReturnDate: text("injury_return_date"), // Expected return date string
    injuryUpdatedAt: timestamp("injury_updated_at"), // When injury info was last synced
  },
  (table) => ({
    sportIdx: index("player_sport_idx").on(table.sport),
    injuryStatusIdx: index("injury_status_idx").on(table.injuryStatus),
    sportTeamIdx: index("player_sport_team_idx").on(table.sport, table.team),
    sportPositionIdx: index("player_sport_position_idx").on(table.sport, table.position),
    teamIdx: index("team_idx").on(table.team),
    activeIdx: index("active_idx").on(table.isActive),
    positionIdx: index("position_idx").on(table.position),
    nameIdx: index("name_idx").on(table.firstName, table.lastName),
    lastTradePriceIdx: index("last_trade_price_idx").on(table.lastTradePrice),
    volume24hIdx: index("volume_24h_idx").on(table.volume24h),
    priceChange24hIdx: index("price_change_24h_idx").on(table.priceChange24h),
    marketCapIdx: index("market_cap_idx").on(table.marketCap),
  }),
);

export const playerIdAliases = pgTable(
  "player_id_aliases",
  {
    aliasPlayerId: varchar("alias_player_id").primaryKey(),
    canonicalPlayerId: varchar("canonical_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    sport: text("sport").notNull(),
    reason: text("reason").notNull().default("duplicate_merge"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    canonicalIdx: index("player_id_aliases_canonical_idx").on(table.canonicalPlayerId),
    sportCanonicalIdx: index("player_id_aliases_sport_canonical_idx").on(
      table.sport,
      table.canonicalPlayerId,
    ),
  }),
);

// Player market metrics table - precomputed sortable metrics for high-scale player lists
export const playerMarketMetrics = pgTable(
  "player_market_metrics",
  {
    playerId: varchar("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    avgFantasyPoints: decimal("avg_fantasy_points", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    buyPressure: decimal("buy_pressure", { precision: 5, scale: 2 }).notNull().default("50.00"),
    totalOrderVolume24h: integer("total_order_volume_24h").notNull().default(0),
    valueIndex: decimal("value_index", { precision: 10, scale: 2 }).notNull().default("0.00"),
    bestBid: decimal("best_bid", { precision: 10, scale: 2 }).notNull().default("0.00"),
    bestAsk: decimal("best_ask", { precision: 10, scale: 2 }).notNull().default("0.00"),
    bidSize: integer("bid_size").notNull().default(0),
    askSize: integer("ask_size").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    avgFantasyPointsIdx: index("pmm_avg_fantasy_points_idx").on(table.avgFantasyPoints),
    buyPressureIdx: index("pmm_buy_pressure_idx").on(table.buyPressure),
    valueIndexIdx: index("pmm_value_index_idx").on(table.valueIndex),
    bestBidIdx: index("pmm_best_bid_idx").on(table.bestBid),
    bestAskIdx: index("pmm_best_ask_idx").on(table.bestAsk),
    updatedAtIdx: index("pmm_updated_at_idx").on(table.updatedAt),
  }),
);

// Holdings table - user ownership of player shares and premium shares
export const holdings = pgTable(
  "holdings",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assetType: text("asset_type").notNull(), // "player" or "premium"
    assetId: text("asset_id").notNull(), // player ID or "premium"
    quantity: decimal("quantity", { precision: 12, scale: 4 }).notNull().default("0"),
    avgCostBasis: decimal("avg_cost_basis", { precision: 10, scale: 4 })
      .notNull()
      .default("0.0000"), // Average cost per share
    totalCostBasis: decimal("total_cost_basis", { precision: 20, scale: 2 })
      .notNull()
      .default("0.00"), // Total invested
    lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  },
  (table) => ({
    userAssetIdx: uniqueIndex("holdings_user_asset_idx").on(
      table.userId,
      table.assetType,
      table.assetId,
    ),
  }),
);

// Player multipliers table - one non-tradeable stacked-share record per user/player
export const playerMultipliers = pgTable(
  "player_multipliers",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    multiplier: integer("multiplier").notNull(),
    avgCostBasis: decimal("avg_cost_basis", { precision: 10, scale: 4 })
      .notNull()
      .default("0.0000"),
    totalCostBasis: decimal("total_cost_basis", { precision: 20, scale: 2 })
      .notNull()
      .default("0.00"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userPlayerIdx: uniqueIndex("player_multiplier_user_player_idx").on(
      table.userId,
      table.playerId,
    ),
    playerIdx: index("player_multiplier_player_idx").on(table.playerId),
  }),
);

// Immutable ledger for stacked-share lifecycle changes
export const playerMultiplierEvents = pgTable(
  "player_multiplier_events",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // stack_shares, boost_burn, migration_backfill
    sharesConsumed: integer("shares_consumed").notNull().default(0),
    effectiveSharesBurned: integer("effective_shares_burned").notNull().default(0),
    multiplierDelta: integer("multiplier_delta").notNull().default(0),
    multiplierAfter: integer("multiplier_after").notNull().default(0),
    consumedTotalCostBasis: decimal("consumed_total_cost_basis", { precision: 20, scale: 2 })
      .notNull()
      .default("0.00"),
    retainedTotalCostBasis: decimal("retained_total_cost_basis", { precision: 20, scale: 2 })
      .notNull()
      .default("0.00"),
    boostId: varchar("boost_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userPlayerCreatedIdx: index("player_multiplier_event_user_player_created_idx").on(
      table.userId,
      table.playerId,
      table.createdAt,
    ),
    eventTypeIdx: index("player_multiplier_event_type_idx").on(table.eventType),
  }),
);

// Holdings locks table - tracks reserved/locked shares to prevent double-spending
// Available shares = holdings.quantity - SUM(holdings_locks.lockedQuantity)
export const holdingsLocks = pgTable(
  "holdings_locks",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assetType: text("asset_type").notNull(), // "player" or "premium"
    assetId: text("asset_id").notNull(), // player ID or "premium"
    lockType: text("lock_type").notNull(), // 'order', 'vesting', 'pending', 'collection', 'other'
    lockReferenceId: varchar("lock_reference_id").notNull(), // ID of order, allocation, transaction, etc.
    lockedQuantity: decimal("locked_quantity", { precision: 20, scale: 4 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userAssetIdx: index("locks_user_asset_idx").on(table.userId, table.assetType, table.assetId),
    referenceIdx: index("locks_reference_idx").on(table.lockReferenceId),
    collectionReferenceIdx: uniqueIndex("locks_collection_reference_unique")
      .on(table.lockReferenceId)
      .where(sql`${table.lockType} = 'collection'`),
    lockTypeIdx: index("locks_type_idx").on(table.lockType),
  }),
);

// Balance locks table - tracks reserved cash to prevent double-spending
// Available balance = users.balance - SUM(balance_locks.lockedAmount)
export const balanceLocks = pgTable(
  "balance_locks",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lockType: text("lock_type").notNull(), // "order" (for buy orders)
    lockReferenceId: varchar("lock_reference_id").notNull(), // order ID
    lockedAmount: decimal("locked_amount", { precision: 20, scale: 2 }).notNull().default("0.00"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("balance_locks_user_idx").on(table.userId),
    referenceIdx: index("balance_locks_reference_idx").on(table.lockReferenceId),
    lockTypeIdx: index("balance_locks_type_idx").on(table.lockType),
  }),
);

// Orders table - limit and market orders on the order book
export const orders = pgTable(
  "orders",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    orderType: text("order_type").notNull(), // "limit" or "market"
    side: text("side").notNull(), // "buy" or "sell"
    quantity: integer("quantity").notNull(),
    filledQuantity: integer("filled_quantity").notNull().default(0),
    limitPrice: decimal("limit_price", { precision: 10, scale: 2 }), // null for market orders
    status: text("status").notNull().default("open"), // "open", "filled", "cancelled", "partial"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    playerSideIdx: index("player_side_idx").on(table.playerId, table.side, table.status),
    userIdx: index("user_idx").on(table.userId),
  }),
);

// Trades table - executed trade history
export const trades = pgTable(
  "trades",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    buyerId: varchar("buyer_id")
      .notNull()
      .references(() => users.id),
    sellerId: varchar("seller_id")
      .notNull()
      .references(() => users.id),
    buyOrderId: varchar("buy_order_id").references(() => orders.id),
    sellOrderId: varchar("sell_order_id").references(() => orders.id),
    quantity: decimal("quantity", { precision: 12, scale: 4 }).notNull(),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    executedAt: timestamp("executed_at").notNull().defaultNow(),
  },
  (table) => ({
    playerIdx: index("player_trade_idx").on(table.playerId),
    executedIdx: index("executed_idx").on(table.executedAt),
    playerExecutedIdx: index("trades_player_executed_at_idx").on(table.playerId, table.executedAt),
  }),
);

// Player Pools table - AMM constant product pools for instant trading
// x * y = k where x=shares, y=play_money (Sportfolio Bucks)
export const playerPools = pgTable(
  "player_pools",
  {
    playerId: varchar("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    shares: decimal("shares", { precision: 12, scale: 2 }).notNull().default("0"),
    playMoney: decimal("play_money", { precision: 12, scale: 2 }).notNull().default("0"),
    k: decimal("k", { precision: 24, scale: 2 }).notNull().default("0"),
    lpSharesTotal: decimal("lp_shares_total", { precision: 24, scale: 2 }).notNull().default("0"),
    feesAccumulated: decimal("fees_accumulated", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    feeGrowthPerLpShare: decimal("fee_growth_per_lp_share", { precision: 24, scale: 12 })
      .notNull()
      .default("0"),
    totalVolume: decimal("total_volume", { precision: 12, scale: 2 }).notNull().default("0"),
    totalTrades: integer("total_trades").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    updatedIdx: index("player_pools_updated_idx").on(table.updatedAt),
  }),
);

// LP Positions table - Tracks user ownership of liquidity provider tokens
export const lpPositions = pgTable(
  "lp_positions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    lpShares: decimal("lp_shares", { precision: 24, scale: 2 }).notNull().default("0"),
    feeGrowthSnapshot: decimal("fee_growth_snapshot", { precision: 24, scale: 12 })
      .notNull()
      .default("0"),
    feesEarnedTotal: decimal("fees_earned_total", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userPlayerUniqueIdx: uniqueIndex("lp_user_player_unique_idx").on(table.userId, table.playerId),
    userIdx: index("lp_user_idx").on(table.userId),
    playerIdx: index("lp_player_idx").on(table.playerId),
    sharesIdx: index("lp_shares_idx").on(table.lpShares),
  }),
);

// LP Transactions table - Audit trail for liquidity additions/removals
export const lpTransactions = pgTable(
  "lp_transactions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    transactionType: text("transaction_type").notNull(), // 'add' or 'remove'
    lpShares: decimal("lp_shares", { precision: 24, scale: 2 }).notNull(),
    sharesAmount: decimal("shares_amount", { precision: 12, scale: 2 }).notNull(),
    playMoneyAmount: decimal("play_money_amount", { precision: 12, scale: 2 }).notNull(),
    poolSharesBefore: decimal("pool_shares_before", { precision: 12, scale: 2 }).notNull(),
    poolPlayMoneyBefore: decimal("pool_play_money_before", { precision: 12, scale: 2 }).notNull(),
    poolLpSharesTotalBefore: decimal("pool_lp_shares_total_before", {
      precision: 24,
      scale: 2,
    }).notNull(),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("lp_tx_user_idx").on(table.userId),
    playerIdx: index("lp_tx_player_idx").on(table.playerId),
    timestampIdx: index("lp_tx_timestamp_idx").on(table.timestamp),
  }),
);

// Insert schemas for AMM/LP tables
export const insertPlayerPoolSchema = createInsertSchema(playerPools).omit({
  k: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLpPositionSchema = createInsertSchema(lpPositions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLpTransactionSchema = createInsertSchema(lpTransactions).omit({
  id: true,
  timestamp: true,
});

// Vesting table - tracks user vesting state
export const vesting = pgTable("vesting", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  playerId: varchar("player_id").references(() => players.id), // null for premium users with split vesting
  sharesAccumulated: integer("shares_accumulated").notNull().default(0),
  residualMs: integer("residual_ms").notNull().default(0), // Fractional time carryover in milliseconds
  lastAccruedAt: timestamp("last_accrued_at").notNull().defaultNow(), // Baseline timestamp for accrual calculation
  lastClaimedAt: timestamp("last_claimed_at"),
  capReachedAt: timestamp("cap_reached_at"), // When they hit their cap
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Vesting splits table - for premium users splitting vesting across players
export const vestingSplits = pgTable(
  "vesting_splits",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    sharesPerHour: integer("shares_per_hour").notNull(),
  },
  (table) => ({
    userIdx: index("user_split_idx").on(table.userId),
  }),
);

// Vesting claims table - immutable log of individual claim events
export const vestingClaims = pgTable(
  "vesting_claims",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id").references(() => players.id), // null for premium split vesting
    sharesClaimed: integer("shares_claimed").notNull(),
    claimedAt: timestamp("claimed_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("vesting_claims_user_idx").on(table.userId),
    claimedAtIdx: index("vesting_claims_claimed_at_idx").on(table.claimedAt),
  }),
);

// Vesting presets table - saved player groups for quick redemption
export const vestingPresets = pgTable(
  "vesting_presets",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    playerIds: text("player_ids").array().notNull(), // Array of player IDs (max 20)
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("vesting_presets_user_idx").on(table.userId),
  }),
);

// Scout Engine: Scout assignments - tracks which players each user is scouting
// Users can stack multiple scouts (up to 5 standard, 10 premium) on players
export const scoutAssignments = pgTable(
  "scout_assignments",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    scoutCount: integer("scout_count").notNull().default(1), // Number of scouts stacked on this player
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userPlayerUniqueIdx: uniqueIndex("scout_user_player_unique_idx").on(
      table.userId,
      table.playerId,
    ),
    playerIdx: index("scout_player_idx").on(table.playerId),
    userIdx: index("scout_user_idx").on(table.userId),
  }),
);

// Scout Engine: Scout distributions - immutable ledger of hourly share distributions
// Formula: (60 Shares) * (User's Scout-Minutes / Total Global Scout-Minutes)
export const scoutDistributions = pgTable(
  "scout_distributions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    hourTimestamp: timestamp("hour_timestamp").notNull(), // Hour bucket (truncated to hour)
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userScoutMinutes: integer("user_scout_minutes").notNull(), // User's scout-minutes for this hour
    globalScoutMinutes: integer("global_scout_minutes").notNull(), // Total scout-minutes for this player
    sharesEarned: decimal("shares_earned", { precision: 10, scale: 2 }).notNull(), // Rounded to .01
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    hourPlayerIdx: index("scout_dist_hour_player_idx").on(table.hourTimestamp, table.playerId),
    userHourIdx: index("scout_dist_user_hour_idx").on(table.userId, table.hourTimestamp),
  }),
);

// Durable idempotency claims for scout distribution events. Kept separate from the
// historical ledger because legacy scout_distributions rows are not unique.
export const scoutDistributionClaims = pgTable(
  "scout_distribution_claims",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    hourTimestamp: timestamp("hour_timestamp").notNull(),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    eventUniqueIdx: uniqueIndex("scout_distribution_claims_event_idx").on(
      table.hourTimestamp,
      table.playerId,
      table.userId,
    ),
  }),
);

// Scout Engine: Scout History - Tracks duration of assignments for minute-level precision
// Used to calculate "Scout-Minutes" when users change scouts mid-hour.
export const scoutHistory = pgTable(
  "scout_history",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    scoutCount: integer("scout_count").notNull(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"), // Null if currently active
  },
  (table) => ({
    userTimeIdx: index("scout_history_user_time_idx").on(
      table.userId,
      table.startedAt,
      table.endedAt,
    ),
    playerTimeIdx: index("scout_history_player_time_idx").on(
      table.playerId,
      table.startedAt,
      table.endedAt,
    ),
  }),
);

// Player game stats table - for all sports
// NBA: uses dedicated columns for backwards compatibility
// NFL: uses statsJson for flexible stat storage
export const playerGameStats = pgTable(
  "player_game_stats",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    gameId: text("game_id").notNull(), // API game ID
    sport: text("sport").notNull().default("NBA"), // NBA, NFL, etc.
    gameDate: timestamp("game_date").notNull(),
    week: integer("week"), // NFL week number (null for NBA)
    season: text("season").notNull().default("2024-2025-regular"), // Track season for historical data
    opponentTeam: text("opponent_team"), // Opponent abbreviation
    homeAway: text("home_away"), // "home" or "away"
    // Sport-specific stats stored as JSON (used for NFL and future sports)
    statsJson: jsonb("stats_json").notNull().default("{}"),
    // NBA-specific columns (kept for backward compatibility)
    minutes: integer("minutes").notNull().default(0), // Minutes played
    points: integer("points").notNull().default(0),
    fieldGoalsMade: integer("field_goals_made").notNull().default(0),
    fieldGoalsAttempted: integer("field_goals_attempted").notNull().default(0),
    threePointersMade: integer("three_pointers_made").notNull().default(0),
    threePointersAttempted: integer("three_pointers_attempted").notNull().default(0),
    freeThrowsMade: integer("free_throws_made").notNull().default(0),
    freeThrowsAttempted: integer("free_throws_attempted").notNull().default(0),
    rebounds: integer("rebounds").notNull().default(0),
    assists: integer("assists").notNull().default(0),
    steals: integer("steals").notNull().default(0),
    blocks: integer("blocks").notNull().default(0),
    turnovers: integer("turnovers").notNull().default(0),
    isDoubleDouble: boolean("is_double_double").notNull().default(false),
    isTripleDouble: boolean("is_triple_double").notNull().default(false),
    // Common field
    fantasyPoints: decimal("fantasy_points", { precision: 10, scale: 2 }).notNull().default("0.00"),
    lastFetchedAt: timestamp("last_fetched_at").notNull().defaultNow(), // Track ingestion time
  },
  (table) => ({
    sportIdx: index("game_stats_sport_idx").on(table.sport),
    sportWeekIdx: index("game_stats_sport_week_idx").on(table.sport, table.week),
    sportPlayerIdx: index("game_stats_sport_player_idx").on(table.sport, table.playerId),
    playerGameIdx: index("player_game_idx").on(table.playerId, table.gameId),
  }),
);

// Price history table - for charts
export const priceHistory = pgTable(
  "price_history",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    volume: integer("volume").notNull().default(0),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
  },
  (table) => ({
    playerTimeIdx: index("player_time_idx").on(table.playerId, table.timestamp),
  }),
);

// Daily games table - cached game schedules for all sports
export const dailyGames = pgTable(
  "daily_games",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    gameId: text("game_id").notNull().unique(), // API game ID (prefixed for clarity)
    sport: text("sport").notNull().default("NBA"), // NBA, NFL, etc.
    date: timestamp("date", { withTimezone: true }).notNull(), // Game date
    week: integer("week"), // NFL week number (1-18 for regular season, null for NBA)
    season: integer("season"), // NFL season start year; null for sports that do not use it here
    seasonType: text("season_type"), // NFL: preseason | regular | postseason
    homeTeam: text("home_team").notNull(), // Team abbreviation
    awayTeam: text("away_team").notNull(), // Team abbreviation
    venue: text("venue"),
    status: text("status").notNull().default("scheduled"), // "scheduled", "inprogress", "completed", "postponed"
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    homeScore: integer("home_score"), // null for scheduled games
    awayScore: integer("away_score"), // null for scheduled games
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sportIdx: index("daily_games_sport_idx").on(table.sport),
    sportDateIdx: index("daily_games_sport_date_idx").on(table.sport, table.date),
    sportWeekIdx: index("daily_games_sport_week_idx").on(table.sport, table.week),
    sportSeasonWeekIdx: index("daily_games_sport_season_week_idx").on(
      table.sport,
      table.season,
      table.week,
    ),
    dateIdx: index("daily_games_date_idx").on(table.date),
    statusIdx: index("daily_games_status_idx").on(table.status),
    gameIdDateIdx: index("daily_games_game_date_idx").on(table.gameId, table.date),
  }),
);

// Job execution logs - track sync job runs for monitoring
export const jobExecutionLogs = pgTable(
  "job_execution_logs",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    jobName: text("job_name").notNull(), // e.g., "roster_sync", "schedule_sync", "stats_sync"
    scheduledFor: timestamp("scheduled_for").notNull(), // When job was supposed to run
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    status: text("status").notNull().default("running"), // "running", "success", "failed", "degraded"
    errorMessage: text("error_message"),
    requestCount: integer("request_count").notNull().default(0), // API requests made during job
    recordsProcessed: integer("records_processed").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0), // Number of failed records
  },
  (table) => ({
    jobNameIdx: index("job_name_idx").on(table.jobName),
    scheduledIdx: index("scheduled_idx").on(table.scheduledFor),
  }),
);

// Blog posts table - admin-created content for SEO and user engagement
export const blogPosts = pgTable(
  "blog_posts",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(), // URL-friendly version of title
    excerpt: text("excerpt").notNull(), // Brief summary for listing pages
    content: text("content").notNull(), // Full blog post content (can be markdown or HTML)
    authorId: varchar("author_id")
      .notNull()
      .references(() => users.id),
    publishedAt: timestamp("published_at"), // null = draft, non-null = published
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: index("blog_slug_idx").on(table.slug),
    publishedIdx: index("blog_published_idx").on(table.publishedAt),
    authorIdx: index("blog_author_idx").on(table.authorId),
  }),
);

// Portfolio snapshots table - daily snapshots of user portfolio metrics for historical tracking and rank changes
export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    snapshotDate: timestamp("snapshot_date").notNull(), // Date this snapshot was taken (UTC midnight)
    cashBalance: decimal("cash_balance", { precision: 20, scale: 2 }).notNull(),
    portfolioValue: decimal("portfolio_value", { precision: 20, scale: 2 }).notNull(),
    totalNetWorth: decimal("total_net_worth", { precision: 20, scale: 2 }).notNull(), // cashBalance + portfolioValue
    cashRank: integer("cash_rank"), // User's rank on cash balance leaderboard
    portfolioRank: integer("portfolio_rank"), // User's rank on portfolio value leaderboard
    netWorthRank: integer("net_worth_rank"), // User's rank on total net worth leaderboard
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userDateIdx: index("portfolio_snapshots_user_date_idx").on(table.userId, table.snapshotDate),
    dateIdx: index("portfolio_snapshots_date_idx").on(table.snapshotDate),
  }),
);

// Market snapshots table - daily snapshots of platform-wide market metrics for analytics charts
export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    snapshotDate: timestamp("snapshot_date").notNull().unique(), // One row per day (UTC midnight)
    marketCap: decimal("market_cap", { precision: 20, scale: 2 }).notNull(), // Total value of all shares (shares * price)
    transactionsCount: integer("transactions_count").notNull().default(0), // Number of trades that day
    volume: decimal("volume", { precision: 20, scale: 2 }).notNull().default("0"), // Total trading volume that day
    sharesVested: integer("shares_vested").notNull().default(0), // Shares vested that day
    sharesBurned: integer("shares_burned").notNull().default(0), // Shares burned by boost participation that day
    totalShares: integer("total_shares").notNull().default(0), // Total shares in economy (snapshot)
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    dateIdx: index("market_snapshots_date_idx").on(table.snapshotDate),
  }),
);

// Bot profiles table - configuration for market maker bots
export const botProfiles = pgTable(
  "bot_profiles",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .unique(),
    botName: text("bot_name").notNull(), // Human-readable name like "MarketMaker_Alpha"
    botRole: text("bot_role").notNull(), // "market_maker", "trader", "vester", "casual"
    isActive: boolean("is_active").notNull().default(true), // Enable/disable this bot
    // Trading configuration
    aggressiveness: decimal("aggressiveness", { precision: 3, scale: 2 }).notNull().default("0.50"), // 0.0-1.0 scale
    spreadPercent: decimal("spread_percent", { precision: 5, scale: 2 }).notNull().default("2.00"), // Bid/ask spread percentage
    maxOrderSize: integer("max_order_size").notNull().default(100), // Maximum shares per order
    minOrderSize: integer("min_order_size").notNull().default(5), // Minimum shares per order
    maxDailyOrders: integer("max_daily_orders").notNull().default(50), // Daily order cap
    maxDailyVolume: integer("max_daily_volume").notNull().default(1000), // Max shares traded per day
    targetTiers: integer("target_tiers").array(), // Player tiers to target (1-5), null = all tiers
    strategyPrompt: text("strategy_prompt").notNull().default(""), // Persona / role-specific operating prompt
    allowedMechanics: text("allowed_mechanics")
      .array()
      .notNull()
      .default(sql`ARRAY['market','liquidity','scouting','boosts']::text[]`),
    objectiveWeights: jsonb("objective_weights")
      .notNull()
      .default(sql`'{"priceMovement":0.45,"liquidityCoverage":0.35,"variety":0.20}'::jsonb`),
    researchEnabled: boolean("research_enabled").notNull().default(false),
    researchQueryBudget: integer("research_query_budget").notNull().default(1),
    researchTtlMinutes: integer("research_ttl_minutes").notNull().default(90),
    maxActionsPerTick: integer("max_actions_per_tick").notNull().default(2),
    maxPlayerExposurePercent: decimal("max_player_exposure_percent", { precision: 5, scale: 2 })
      .notNull()
      .default("25.00"),
    // Vesting configuration
    vestingClaimThreshold: decimal("vesting_claim_threshold", { precision: 3, scale: 2 })
      .notNull()
      .default("0.85"), // Claim at 85% of cap
    maxPlayersToVest: integer("max_players_to_vest").notNull().default(5), // Max players to split vesting across
    // Timing configuration
    minActionCooldownMs: integer("min_action_cooldown_ms").notNull().default(60000), // 1 minute minimum between actions
    maxActionCooldownMs: integer("max_action_cooldown_ms").notNull().default(300000), // 5 minute max cooldown
    activeHoursStart: integer("active_hours_start").notNull().default(8), // Start hour (0-23 UTC)
    activeHoursEnd: integer("active_hours_end").notNull().default(23), // End hour (0-23 UTC)
    // State tracking
    lastActionAt: timestamp("last_action_at"),
    ordersToday: integer("orders_today").notNull().default(0),
    volumeToday: integer("volume_today").notNull().default(0),
    lastResetDate: timestamp("last_reset_date").notNull().defaultNow(), // Reset daily counters
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    roleIdx: index("bot_role_idx").on(table.botRole),
    activeIdx: index("bot_active_idx").on(table.isActive),
  }),
);

// Bot actions log table - audit trail of all bot actions
export const botActionsLog = pgTable(
  "bot_actions_log",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    botUserId: varchar("bot_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(), // "order_placed", "order_cancelled", "vesting_claim", "vesting_selection"
    actionDetails: jsonb("action_details").notNull(), // JSON with specific details (order ID, player ID, amounts, etc.)
    triggerReason: text("trigger_reason").notNull(), // Why this action was taken
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    botUserIdx: index("bot_actions_user_idx").on(table.botUserId),
    actionTypeIdx: index("bot_actions_type_idx").on(table.actionType),
    createdAtIdx: index("bot_actions_created_idx").on(table.createdAt),
  }),
);

export const botCycleBriefs = pgTable(
  "bot_cycle_briefs",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    cycleKey: text("cycle_key").notNull().unique(),
    coordinatorBotUserId: varchar("coordinator_bot_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("ready"),
    summary: text("summary").notNull(),
    sharedPrompt: text("shared_prompt").notNull(),
    briefPayload: jsonb("brief_payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    warnings: jsonb("warnings")
      .notNull()
      .default(sql`'[]'::jsonb`),
    citations: jsonb("citations")
      .notNull()
      .default(sql`'[]'::jsonb`),
    toolTrace: jsonb("tool_trace")
      .notNull()
      .default(sql`'[]'::jsonb`),
    usedResearch: boolean("used_research").notNull().default(false),
    researchQueryCount: integer("research_query_count").notNull().default(0),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    expiresIdx: index("bot_cycle_briefs_expires_idx").on(table.expiresAt),
    createdIdx: index("bot_cycle_briefs_created_idx").on(table.createdAt),
  }),
);

export const botRunLogs = pgTable(
  "bot_run_logs",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    cycleKey: text("cycle_key").notNull(),
    botUserId: varchar("bot_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    botProfileId: varchar("bot_profile_id")
      .notNull()
      .references(() => botProfiles.id, { onDelete: "cascade" }),
    cycleBriefId: varchar("cycle_brief_id").references(() => botCycleBriefs.id, {
      onDelete: "set null",
    }),
    threadId: varchar("thread_id"),
    status: text("status").notNull().default("pending"),
    role: text("role").notNull(),
    summary: text("summary"),
    warnings: jsonb("warnings")
      .notNull()
      .default(sql`'[]'::jsonb`),
    plannedActions: jsonb("planned_actions")
      .notNull()
      .default(sql`'[]'::jsonb`),
    executedActions: jsonb("executed_actions")
      .notNull()
      .default(sql`'[]'::jsonb`),
    citations: jsonb("citations")
      .notNull()
      .default(sql`'[]'::jsonb`),
    toolTrace: jsonb("tool_trace")
      .notNull()
      .default(sql`'[]'::jsonb`),
    usedResearch: boolean("used_research").notNull().default(false),
    researchQueryCount: integer("research_query_count").notNull().default(0),
    failureClass: text("failure_class"),
    metrics: jsonb("metrics")
      .notNull()
      .default(sql`'{}'::jsonb`),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    botCreatedIdx: index("bot_run_logs_bot_created_idx").on(table.botUserId, table.createdAt),
    cycleIdx: index("bot_run_logs_cycle_idx").on(table.cycleKey),
    statusIdx: index("bot_run_logs_status_idx").on(table.status),
    failureClassIdx: index("bot_run_logs_failure_class_idx").on(table.failureClass),
  }),
);

// Premium checkout sessions table - tracks Whop checkout sessions for premium share purchases
export const premiumCheckoutSessions = pgTable(
  "premium_checkout_sessions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    whopSessionId: varchar("whop_session_id").unique(), // Whop's session ID (if using session API)
    planId: text("plan_id").notNull(), // Whop plan ID
    quantity: integer("quantity").notNull().default(1), // Number of premium shares to credit
    amountCents: integer("amount_cents").notNull(), // Amount in cents (500 = $5)
    status: text("status").notNull().default("pending"), // "pending", "completed", "failed"
    receiptId: varchar("receipt_id").unique(), // Whop receipt/payment ID for idempotency
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("premium_checkout_user_idx").on(table.userId),
    statusIdx: index("premium_checkout_status_idx").on(table.status),
    receiptIdx: index("premium_checkout_receipt_idx").on(table.receiptId),
  }),
);

// Premium orders table - limit and market orders for premium share trading
export const premiumOrders = pgTable(
  "premium_orders",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderType: text("order_type").notNull(), // "limit" or "market"
    side: text("side").notNull(), // "buy" or "sell"
    quantity: integer("quantity").notNull(),
    filledQuantity: integer("filled_quantity").notNull().default(0),
    limitPrice: decimal("limit_price", { precision: 10, scale: 2 }), // null for market orders
    status: text("status").notNull().default("open"), // "open", "filled", "cancelled", "partial"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    sideStatusIdx: index("premium_orders_side_status_idx").on(table.side, table.status),
    userIdx: index("premium_orders_user_idx").on(table.userId),
    createdAtIdx: index("premium_orders_created_idx").on(table.createdAt),
  }),
);

// Premium trades table - executed premium share trade history
export const premiumTrades = pgTable(
  "premium_trades",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    buyerId: varchar("buyer_id")
      .notNull()
      .references(() => users.id),
    sellerId: varchar("seller_id")
      .notNull()
      .references(() => users.id),
    buyOrderId: varchar("buy_order_id").references(() => premiumOrders.id),
    sellOrderId: varchar("sell_order_id").references(() => premiumOrders.id),
    quantity: integer("quantity").notNull(),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    executedAt: timestamp("executed_at").notNull().defaultNow(),
  },
  (table) => ({
    executedIdx: index("premium_trades_executed_idx").on(table.executedAt),
    buyerIdx: index("premium_trades_buyer_idx").on(table.buyerId),
    sellerIdx: index("premium_trades_seller_idx").on(table.sellerId),
  }),
);

// Premium activity ledger - immutable audit trail for premium inventory and access changes
export const premiumActivityEvents = pgTable(
  "premium_activity_events",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // premium_credit, premium_redeem, premium_admin_credit
    quantityDelta: integer("quantity_delta").notNull().default(0),
    amountCents: integer("amount_cents"),
    daysGranted: integer("days_granted"),
    premiumExpiresAtAfter: timestamp("premium_expires_at_after"),
    referenceId: varchar("reference_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index("premium_activity_user_created_idx").on(table.userId, table.createdAt),
    eventTypeIdx: index("premium_activity_event_type_idx").on(table.eventType),
    referenceIdx: uniqueIndex("premium_activity_event_ref_idx").on(
      table.eventType,
      table.referenceId,
    ),
  }),
);

export const rewardedScoutBoostGrants = pgTable(
  "rewarded_scout_boost_grants",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull().default("android"),
    adNetwork: text("ad_network").notNull().default("admob"),
    adUnitId: text("ad_unit_id"),
    rewardItem: text("reward_item"),
    rewardAmount: integer("reward_amount"),
    rewardSessionId: varchar("reward_session_id").notNull(),
    transactionId: varchar("transaction_id").notNull(),
    customData: text("custom_data"),
    rewardedAt: timestamp("rewarded_at").notNull(),
    grantedAt: timestamp("granted_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userExpiresIdx: index("rewarded_scout_boost_user_expires_idx").on(
      table.userId,
      table.expiresAt,
    ),
    sessionIdx: index("rewarded_scout_boost_session_idx").on(table.rewardSessionId),
    transactionIdx: uniqueIndex("rewarded_scout_boost_transaction_idx").on(table.transactionId),
  }),
);

// Community checkout sessions table - tracks Whop checkout sessions for community share purchases
// Community shares are used to create community boosts (+1x multiplier for all holders of a player)
export const communityCheckoutSessions = pgTable(
  "community_checkout_sessions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    whopSessionId: varchar("whop_session_id").unique(), // Whop's session ID (if using session API)
    planId: text("plan_id").notNull(), // Whop plan ID (should be WHOP_COMMUNITY_PLAN_ID)
    quantity: integer("quantity").notNull().default(1), // Number of community shares to credit ($1 each)
    amountCents: integer("amount_cents").notNull(), // Amount in cents (100 = $1 per share)
    status: text("status").notNull().default("pending"), // "pending", "completed", "failed"
    receiptId: varchar("receipt_id").unique(), // Whop receipt/payment ID for idempotency
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("community_checkout_user_idx").on(table.userId),
    statusIdx: index("community_checkout_status_idx").on(table.status),
    receiptIdx: index("community_checkout_receipt_idx").on(table.receiptId),
  }),
);

// Community orders table - limit and market orders for community share trading
export const communityOrders = pgTable(
  "community_orders",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderType: text("order_type").notNull(), // "limit" or "market"
    side: text("side").notNull(), // "buy" or "sell"
    quantity: integer("quantity").notNull(),
    filledQuantity: integer("filled_quantity").notNull().default(0),
    limitPrice: decimal("limit_price", { precision: 10, scale: 2 }), // null for market orders
    status: text("status").notNull().default("open"), // "open", "filled", "cancelled", "partial"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    sideStatusIdx: index("community_orders_side_status_idx").on(table.side, table.status),
    userIdx: index("community_orders_user_idx").on(table.userId),
    createdAtIdx: index("community_orders_created_idx").on(table.createdAt),
  }),
);

// Community trades table - executed community share trade history
export const communityTrades = pgTable(
  "community_trades",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    buyerId: varchar("buyer_id")
      .notNull()
      .references(() => users.id),
    sellerId: varchar("seller_id")
      .notNull()
      .references(() => users.id),
    buyOrderId: varchar("buy_order_id").references(() => communityOrders.id),
    sellOrderId: varchar("sell_order_id").references(() => communityOrders.id),
    quantity: integer("quantity").notNull(),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    executedAt: timestamp("executed_at").notNull().defaultNow(),
  },
  (table) => ({
    executedIdx: index("community_trades_executed_idx").on(table.executedAt),
    buyerIdx: index("community_trades_buyer_idx").on(table.buyerId),
    sellerIdx: index("community_trades_seller_idx").on(table.sellerId),
  }),
);

// Whop payments table - tracks Whop purchases for cross-platform crediting
// Used to sync premium shares between Whop and Sportfolio
export const whopPayments = pgTable(
  "whop_payments",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    paymentId: varchar("payment_id").notNull().unique(), // Whop's unique payment ID (primary key for idempotency)
    email: varchar("email").notNull(), // Email from Whop payment (used to match Sportfolio users)
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }), // Sportfolio user who received credit (null if not yet matched)
    quantity: integer("quantity").notNull().default(1), // Number of premium shares purchased
    amountCents: integer("amount_cents").notNull(), // Amount paid in cents
    currency: varchar("currency").notNull().default("usd"),
    whopStatus: text("whop_status").notNull(), // "paid", "refunded", "disputed", etc.
    creditedAt: timestamp("credited_at"), // When shares were credited (null if not yet credited)
    revokedAt: timestamp("revoked_at"), // When shares were revoked due to refund/chargeback
    revokedQuantity: integer("revoked_quantity"), // How many shares were revoked
    liabilityQuantity: integer("liability_quantity").default(0), // Shares owed if user traded them away before revocation
    lastSyncedAt: timestamp("last_synced_at").notNull().defaultNow(), // Last time this payment was synced from Whop
    rawPayload: jsonb("raw_payload"), // Full Whop payment object for debugging
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    paymentIdIdx: index("whop_payments_payment_id_idx").on(table.paymentId),
    emailIdx: index("whop_payments_email_idx").on(table.email),
    userIdIdx: index("whop_payments_user_id_idx").on(table.userId),
    statusIdx: index("whop_payments_status_idx").on(table.whopStatus),
    creditedIdx: index("whop_payments_credited_idx").on(table.creditedAt),
  }),
);

// Google Play purchases table - tracks verified Android in-app purchases for premium crediting
export const googlePlayPurchases = pgTable(
  "google_play_purchases",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    purchaseToken: varchar("purchase_token").notNull().unique(),
    orderId: varchar("order_id"),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    productId: text("product_id").notNull(),
    packageName: text("package_name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    purchaseState: integer("purchase_state"),
    acknowledgementState: integer("acknowledgement_state"),
    consumptionState: integer("consumption_state"),
    purchaseTime: timestamp("purchase_time"),
    isTestPurchase: boolean("is_test_purchase").notNull().default(false),
    creditedAt: timestamp("credited_at"),
    consumedAt: timestamp("consumed_at"),
    lastVerifiedAt: timestamp("last_verified_at").notNull().defaultNow(),
    rawPayload: jsonb("raw_payload").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tokenIdx: uniqueIndex("google_play_purchases_token_idx").on(table.purchaseToken),
    orderIdx: index("google_play_purchases_order_idx").on(table.orderId),
    userIdx: index("google_play_purchases_user_idx").on(table.userId),
    creditedIdx: index("google_play_purchases_credited_idx").on(table.creditedAt),
  }),
);

// Tweet settings table - stores configuration for automated tweets
export const tweetSettings = pgTable("tweet_settings", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  enabled: boolean("enabled").notNull().default(false),
  promptTemplate: text("prompt_template")
    .notNull()
    .default(
      "Give a brief 1-sentence summary of recent NBA news or game performance for these players: {players}. Focus on their most recent game or any breaking news. Keep each summary under 60 characters.",
    ),
  includeRisers: boolean("include_risers").notNull().default(true),
  includeVolume: boolean("include_volume").notNull().default(true),
  includeMarketCap: boolean("include_market_cap").notNull().default(true),
  maxPlayers: integer("max_players").notNull().default(3),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Tweet history table - logs of all tweets sent
export const tweetHistory = pgTable(
  "tweet_history",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    content: text("content").notNull(),
    tweetId: varchar("tweet_id"), // X's tweet ID if successfully posted
    status: text("status").notNull().default("pending"), // "pending", "success", "failed"
    errorMessage: text("error_message"),
    playerData: jsonb("player_data"), // Snapshot of player stats used
    aiSummary: text("ai_summary"), // Perplexity response
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("tweet_history_status_idx").on(table.status),
    createdAtIdx: index("tweet_history_created_idx").on(table.createdAt),
  }),
);

export const redditPostHistory = pgTable(
  "reddit_post_history",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    subreddit: text("subreddit").notNull(),
    postType: text("post_type").notNull(), // "morning_recap" | "pregame_preview"
    marketDay: varchar("market_day", { length: 10 }).notNull(), // YYYY-MM-DD in ET
    title: text("title").notNull(),
    markdown: text("markdown").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    status: text("status").notNull().default("pending"), // "pending" | "posted" | "failed" | "skipped"
    redditPostId: varchar("reddit_post_id"),
    redditPostUrl: text("reddit_post_url"),
    imageUrl: text("image_url"),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    postedAt: timestamp("posted_at"),
    lastAttemptAt: timestamp("last_attempt_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    subredditSlotIdx: uniqueIndex("reddit_post_history_subreddit_slot_idx").on(
      table.subreddit,
      table.postType,
      table.marketDay,
    ),
    statusIdx: index("reddit_post_history_status_idx").on(table.status),
    createdAtIdx: index("reddit_post_history_created_at_idx").on(table.createdAt),
    lastAttemptIdx: index("reddit_post_history_last_attempt_idx").on(table.lastAttemptAt),
  }),
);

// Watchlists table - named lists for organizing players
export const watchlists = pgTable(
  "watchlists",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    color: varchar("color", { length: 20 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("watchlists_user_idx").on(table.userId),
  }),
);

// Watch list items table - tracks players in each watchlist
export const watchList = pgTable(
  "watch_list",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    watchlistId: varchar("watchlist_id").references(() => watchlists.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userPlayerIdx: index("watch_user_player_idx").on(table.userId, table.playerId),
    watchlistIdx: index("watch_watchlist_idx").on(table.watchlistId),
    userWatchlistPlayerIdx: index("watch_user_watchlist_player_idx").on(
      table.userId,
      table.watchlistId,
      table.playerId,
    ),
  }),
);

// News feed table - AI-generated sports news for the News Hub
export const newsFeed = pgTable(
  "news_feed",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    headline: text("headline").notNull(),
    briefing: text("briefing").notNull(),
    sourceUrl: text("source_url"),
    contentHash: varchar("content_hash", { length: 64 }).notNull(), // SHA-256 hash for deduplication
    sport: text("sport").notNull(), // NBA, NFL
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    createdAtIdx: index("news_feed_created_at_idx").on(table.createdAt),
    contentHashIdx: index("news_feed_content_hash_idx").on(table.contentHash),
    sportIdx: index("news_feed_sport_idx").on(table.sport),
  }),
);

// Daily Boosts table - daily multiplier-based payouts
// Users select 4 players from their holdings each day for performance multipliers
export const dailyBoosts = pgTable(
  "daily_boosts",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    sport: text("sport").notNull(), // "NBA" or "NFL"
    slotTier: integer("slot_tier").notNull(), // 2, 3, 4, or 5 (multiplier value)
    boostDate: timestamp("boost_date").notNull(), // The date this boost applies to
    sharesEntered: integer("shares_entered").notNull(), // Shares used for calculation
    shareMultiplier: decimal("share_multiplier", { precision: 10, scale: 2 })
      .notNull()
      .default("1.00"),
    shareSourceType: text("share_source_type").notNull().default("regular"), // regular or stacked
    gameId: text("game_id"), // API game ID for the player's game
    status: text("status").notNull().default("active"), // "active", "locked", "processed", "cancelled"
    fantasyPoints: decimal("fantasy_points", { precision: 10, scale: 2 }), // Final normalized FP after game
    payout: decimal("payout", { precision: 20, scale: 2 }), // Calculated payout
    createdAt: timestamp("created_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"), // When payout was credited
  },
  (table) => ({
    userDateIdx: index("boost_user_date_idx").on(table.userId, table.boostDate),
    userSportDateIdx: index("boost_user_sport_date_idx").on(
      table.userId,
      table.sport,
      table.boostDate,
    ),
    statusIdx: index("boost_status_idx").on(table.status),
    playerIdx: index("boost_player_idx").on(table.playerId),
    gameIdx: index("boost_game_idx").on(table.gameId),
  }),
);

// Boost payouts table - immutable ledger for audit trail
// Records every payout calculation for transparency
export const boostPayouts = pgTable(
  "boost_payouts",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    boostId: varchar("boost_id")
      .notNull()
      .references(() => dailyBoosts.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    sharesUsed: integer("shares_used").notNull(),
    fantasyPoints: decimal("fantasy_points", { precision: 10, scale: 2 }).notNull(),
    multiplier: integer("multiplier").notNull(), // 2, 3, 4, or 5
    payoutAmount: decimal("payout_amount", { precision: 20, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("boost_payout_user_idx").on(table.userId),
    boostIdx: index("boost_payout_boost_idx").on(table.boostId),
    createdAtIdx: index("boost_payout_created_idx").on(table.createdAt),
  }),
);

// Share payouts table - immutable ledger for game-based holder earnings
// Records payouts for user/player/game snapshots settled after game completion
export const sharePayouts = pgTable(
  "share_payouts",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    gameId: text("game_id").notNull(),
    earningUnits: decimal("earning_units", { precision: 12, scale: 2 }).notNull().default("0.00"),
    earningModel: text("earning_model").notNull().default("multiplier_only"),
    baseRate: decimal("base_rate", { precision: 10, scale: 4 }).notNull().default("1.0000"),
    fantasyPoints: decimal("fantasy_points", { precision: 10, scale: 2 }),
    payoutAmount: decimal("payout_amount", { precision: 20, scale: 2 }),
    status: text("status").notNull().default("pending"), // pending, processed, cancelled, voided
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (table) => ({
    userIdx: index("share_payout_user_idx").on(table.userId),
    gameIdx: index("share_payout_game_idx").on(table.gameId),
    statusIdx: index("share_payout_status_idx").on(table.status),
    createdAtIdx: index("share_payout_created_idx").on(table.createdAt),
    userPlayerGameIdx: uniqueIndex("share_payout_user_player_game_idx").on(
      table.userId,
      table.playerId,
      table.gameId,
    ),
  }),
);

// Community Boosts table - global 5x boosts created by premium share redemption
// When a user redeems a premium share, ALL users holding that player benefit from 5x
export const communityBoosts = pgTable(
  "community_boosts",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    creatorId: varchar("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id),
    sport: text("sport").notNull(), // "NBA" or "NFL"
    boostDate: timestamp("boost_date").notNull(), // The date this boost applies to
    gameId: text("game_id"), // API game ID for the player's game
    status: text("status").notNull().default("active"), // "active", "locked", "processed", "cancelled"
    fantasyPoints: decimal("fantasy_points", { precision: 10, scale: 2 }), // Final normalized FP after game
    totalPayout: decimal("total_payout", { precision: 20, scale: 2 }), // Sum of all beneficiary payouts
    beneficiaryCount: integer("beneficiary_count"), // Number of users who benefited
    createdAt: timestamp("created_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"), // When payouts were credited
  },
  (table) => ({
    creatorDateIdx: index("community_boost_creator_date_idx").on(table.creatorId, table.boostDate),
    sportDateIdx: index("community_boost_sport_date_idx").on(table.sport, table.boostDate),
    statusIdx: index("community_boost_status_idx").on(table.status),
    playerIdx: index("community_boost_player_idx").on(table.playerId),
    gameIdx: index("community_boost_game_idx").on(table.gameId),
  }),
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  holdings: many(holdings),
  playerMultipliers: many(playerMultipliers),
  playerMultiplierEvents: many(playerMultiplierEvents),
  orders: many(orders),
  blogPosts: many(blogPosts),
  portfolioSnapshots: many(portfolioSnapshots),
  vestingItems: many(vesting),
  vestingSplits: many(vestingSplits),
  vestingClaims: many(vestingClaims),
  watchlists: many(watchlists),
  watchList: many(watchList),
  dailyBoosts: many(dailyBoosts),
  boostPayouts: many(boostPayouts),
  sharePayouts: many(sharePayouts),
  communityBoosts: many(communityBoosts),
  pushTokens: many(userPushTokens),
  notificationPreferences: many(userNotificationPreferences),
  pushNotificationEvents: many(pushNotificationEvents),
  premiumActivityEvents: many(premiumActivityEvents),
  rewardedScoutBoostGrants: many(rewardedScoutBoostGrants),
  collections: many(userCollections),
  milestones: many(userMilestones),
  notificationSettings: many(userNotificationSettings),
  pushDevices: many(userPushDevices),
  accountDeletionRequests: many(accountDeletionRequests),
}));

export const watchlistsRelations = relations(watchlists, ({ one, many }) => ({
  user: one(users, {
    fields: [watchlists.userId],
    references: [users.id],
  }),
  items: many(watchList),
}));

export const watchListRelations = relations(watchList, ({ one }) => ({
  user: one(users, {
    fields: [watchList.userId],
    references: [users.id],
  }),
  watchlist: one(watchlists, {
    fields: [watchList.watchlistId],
    references: [watchlists.id],
  }),
  player: one(players, {
    fields: [watchList.playerId],
    references: [players.id],
  }),
}));

export const blogPostsRelations = relations(blogPosts, ({ one }) => ({
  author: one(users, {
    fields: [blogPosts.authorId],
    references: [users.id],
  }),
}));

export const portfolioSnapshotsRelations = relations(portfolioSnapshots, ({ one }) => ({
  user: one(users, {
    fields: [portfolioSnapshots.userId],
    references: [users.id],
  }),
}));

export const playersRelations = relations(players, ({ many }) => ({
  holdings: many(holdings),
  playerMultipliers: many(playerMultipliers),
  playerMultiplierEvents: many(playerMultiplierEvents),
  orders: many(orders),
  trades: many(trades),
  gameStats: many(playerGameStats),
  priceHistory: many(priceHistory),
  sharePayouts: many(sharePayouts),
}));

export const holdingsRelations = relations(holdings, ({ one }) => ({
  user: one(users, {
    fields: [holdings.userId],
    references: [users.id],
  }),
}));

export const playerMultipliersRelations = relations(playerMultipliers, ({ one }) => ({
  user: one(users, {
    fields: [playerMultipliers.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [playerMultipliers.playerId],
    references: [players.id],
  }),
}));

export const playerMultiplierEventsRelations = relations(playerMultiplierEvents, ({ one }) => ({
  user: one(users, {
    fields: [playerMultiplierEvents.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [playerMultiplierEvents.playerId],
    references: [players.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [orders.playerId],
    references: [players.id],
  }),
}));

export const dailyBoostsRelations = relations(dailyBoosts, ({ one }) => ({
  user: one(users, {
    fields: [dailyBoosts.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [dailyBoosts.playerId],
    references: [players.id],
  }),
}));

export const boostPayoutsRelations = relations(boostPayouts, ({ one }) => ({
  boost: one(dailyBoosts, {
    fields: [boostPayouts.boostId],
    references: [dailyBoosts.id],
  }),
  user: one(users, {
    fields: [boostPayouts.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [boostPayouts.playerId],
    references: [players.id],
  }),
}));

export const userPushTokensRelations = relations(userPushTokens, ({ one }) => ({
  user: one(users, {
    fields: [userPushTokens.userId],
    references: [users.id],
  }),
}));

export const userNotificationPreferencesRelations = relations(
  userNotificationPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [userNotificationPreferences.userId],
      references: [users.id],
    }),
  }),
);

export const pushNotificationEventsRelations = relations(pushNotificationEvents, ({ one }) => ({
  user: one(users, {
    fields: [pushNotificationEvents.userId],
    references: [users.id],
  }),
}));

export const premiumActivityEventsRelations = relations(premiumActivityEvents, ({ one }) => ({
  user: one(users, {
    fields: [premiumActivityEvents.userId],
    references: [users.id],
  }),
}));

export const rewardedScoutBoostGrantsRelations = relations(rewardedScoutBoostGrants, ({ one }) => ({
  user: one(users, {
    fields: [rewardedScoutBoostGrants.userId],
    references: [users.id],
  }),
}));

export const sharePayoutsRelations = relations(sharePayouts, ({ one }) => ({
  user: one(users, {
    fields: [sharePayouts.userId],
    references: [users.id],
  }),
  player: one(players, {
    fields: [sharePayouts.playerId],
    references: [players.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
});

export const insertPlayerSchema = createInsertSchema(players).omit({
  lastUpdated: true,
});

export const insertPlayerMarketMetricsSchema = createInsertSchema(playerMarketMetrics).omit({
  updatedAt: true,
});

export const insertHoldingSchema = createInsertSchema(holdings).omit({
  id: true,
  lastUpdated: true,
});

export const insertPlayerMultiplierSchema = createInsertSchema(playerMultipliers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPlayerMultiplierEventSchema = createInsertSchema(playerMultiplierEvents).omit({
  id: true,
  createdAt: true,
});

export const insertHoldingsLockSchema = createInsertSchema(holdingsLocks).omit({
  id: true,
  createdAt: true,
});

export const insertOrderSchema = createInsertSchema(orders)
  .omit({
    id: true,
    filledQuantity: true,
    status: true,
    createdAt: true,
  })
  .extend({
    quantity: z.number().int().positive(),
    limitPrice: z.string().optional(),
  });

export const insertDailyGameSchema = createInsertSchema(dailyGames).omit({
  id: true,
  lastFetchedAt: true,
});

export const insertJobExecutionLogSchema = createInsertSchema(jobExecutionLogs).omit({
  id: true,
  startedAt: true,
});

export const insertPlayerGameStatsSchema = createInsertSchema(playerGameStats).omit({
  id: true,
  lastFetchedAt: true,
});

export const insertVestingSchema = createInsertSchema(vesting).omit({
  id: true,
  updatedAt: true,
});

export const insertVestingSplitSchema = createInsertSchema(vestingSplits).omit({
  id: true,
});

export const insertVestingClaimSchema = createInsertSchema(vestingClaims).omit({
  id: true,
  claimedAt: true,
});

export const insertVestingPresetSchema = createInsertSchema(vestingPresets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Scout Engine insert schemas
export const insertScoutAssignmentSchema = createInsertSchema(scoutAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScoutDistributionSchema = createInsertSchema(scoutDistributions).omit({
  id: true,
  createdAt: true,
});

export const insertScoutHistorySchema = createInsertSchema(scoutHistory).omit({
  id: true,
  startedAt: true,
});

// Select types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = typeof users.$inferInsert; // For auth upsert operation

export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;

export const insertPlayerIdAliasSchema = createInsertSchema(playerIdAliases).omit({
  createdAt: true,
  updatedAt: true,
});

export type PlayerIdAlias = typeof playerIdAliases.$inferSelect;
export type InsertPlayerIdAlias = z.infer<typeof insertPlayerIdAliasSchema>;

export type PlayerMarketMetrics = typeof playerMarketMetrics.$inferSelect;
export type InsertPlayerMarketMetrics = z.infer<typeof insertPlayerMarketMetricsSchema>;

export type Holding = typeof holdings.$inferSelect;
export type InsertHolding = z.infer<typeof insertHoldingSchema>;

export type PlayerMultiplier = typeof playerMultipliers.$inferSelect;
export type InsertPlayerMultiplier = z.infer<typeof insertPlayerMultiplierSchema>;

export type PlayerMultiplierEvent = typeof playerMultiplierEvents.$inferSelect;
export type InsertPlayerMultiplierEvent = z.infer<typeof insertPlayerMultiplierEventSchema>;

export type HoldingsLock = typeof holdingsLocks.$inferSelect;
export type InsertHoldingsLock = z.infer<typeof insertHoldingsLockSchema>;

export type BalanceLock = typeof balanceLocks.$inferSelect;

export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;

export type Trade = typeof trades.$inferSelect;

export type Vesting = typeof vesting.$inferSelect;
export type InsertVesting = z.infer<typeof insertVestingSchema>;

export type VestingSplit = typeof vestingSplits.$inferSelect;
export type InsertVestingSplit = z.infer<typeof insertVestingSplitSchema>;

export type VestingClaim = typeof vestingClaims.$inferSelect;
export type InsertVestingClaim = z.infer<typeof insertVestingClaimSchema>;

export type VestingPreset = typeof vestingPresets.$inferSelect;
export type InsertVestingPreset = z.infer<typeof insertVestingPresetSchema>;

// Scout Engine types
export type ScoutAssignment = typeof scoutAssignments.$inferSelect;
export type InsertScoutAssignment = z.infer<typeof insertScoutAssignmentSchema>;

export type ScoutDistribution = typeof scoutDistributions.$inferSelect;
export type InsertScoutDistribution = z.infer<typeof insertScoutDistributionSchema>;

export type ScoutHistory = typeof scoutHistory.$inferSelect;
export type InsertScoutHistory = z.infer<typeof insertScoutHistorySchema>;

export type DailyGame = typeof dailyGames.$inferSelect;
export type InsertDailyGame = z.infer<typeof insertDailyGameSchema>;

export type JobExecutionLog = typeof jobExecutionLogs.$inferSelect;
export type InsertJobExecutionLog = z.infer<typeof insertJobExecutionLogSchema>;

export type PlayerGameStats = typeof playerGameStats.$inferSelect;
export type InsertPlayerGameStats = z.infer<typeof insertPlayerGameStatsSchema>;

export type PriceHistory = typeof priceHistory.$inferSelect;

export const insertBlogPostSchema = createInsertSchema(blogPosts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BlogPost = typeof blogPosts.$inferSelect;
export type InsertBlogPost = z.infer<typeof insertBlogPostSchema>;

export const insertPortfolioSnapshotSchema = createInsertSchema(portfolioSnapshots).omit({
  id: true,
  createdAt: true,
});

export type PortfolioSnapshot = typeof portfolioSnapshots.$inferSelect;
export type InsertPortfolioSnapshot = z.infer<typeof insertPortfolioSnapshotSchema>;

export const insertMarketSnapshotSchema = createInsertSchema(marketSnapshots).omit({
  id: true,
  createdAt: true,
});

export type MarketSnapshot = typeof marketSnapshots.$inferSelect;
export type InsertMarketSnapshot = z.infer<typeof insertMarketSnapshotSchema>;

// Bot profile schemas and types
export const insertBotProfileSchema = createInsertSchema(botProfiles).omit({
  id: true,
  lastActionAt: true,
  ordersToday: true,
  volumeToday: true,
  lastResetDate: true,
  createdAt: true,
  updatedAt: true,
});

export type BotProfile = typeof botProfiles.$inferSelect;
export type InsertBotProfile = z.infer<typeof insertBotProfileSchema>;

// Bot actions log schemas and types
export const insertBotActionLogSchema = createInsertSchema(botActionsLog).omit({
  id: true,
  createdAt: true,
});

export type BotActionLog = typeof botActionsLog.$inferSelect;
export type InsertBotActionLog = z.infer<typeof insertBotActionLogSchema>;

export const insertBotCycleBriefSchema = createInsertSchema(botCycleBriefs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BotCycleBrief = typeof botCycleBriefs.$inferSelect;
export type InsertBotCycleBrief = z.infer<typeof insertBotCycleBriefSchema>;

export const insertBotRunLogSchema = createInsertSchema(botRunLogs).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export type BotRunLog = typeof botRunLogs.$inferSelect;
export type InsertBotRunLog = z.infer<typeof insertBotRunLogSchema>;

// Premium checkout session schemas and types
export const insertPremiumCheckoutSessionSchema = createInsertSchema(premiumCheckoutSessions).omit({
  id: true,
  status: true,
  completedAt: true,
  createdAt: true,
});

export type PremiumCheckoutSession = typeof premiumCheckoutSessions.$inferSelect;
export type InsertPremiumCheckoutSession = z.infer<typeof insertPremiumCheckoutSessionSchema>;

// Premium order schemas and types
export const insertPremiumOrderSchema = createInsertSchema(premiumOrders).omit({
  id: true,
  filledQuantity: true,
  status: true,
  createdAt: true,
});

export type PremiumOrder = typeof premiumOrders.$inferSelect;
export type InsertPremiumOrder = z.infer<typeof insertPremiumOrderSchema>;

// Premium trade schemas and types
export const insertPremiumTradeSchema = createInsertSchema(premiumTrades).omit({
  id: true,
  executedAt: true,
});

export type PremiumTrade = typeof premiumTrades.$inferSelect;
export type InsertPremiumTrade = z.infer<typeof insertPremiumTradeSchema>;

export const insertPremiumActivityEventSchema = createInsertSchema(premiumActivityEvents).omit({
  id: true,
  createdAt: true,
});

export type PremiumActivityEvent = typeof premiumActivityEvents.$inferSelect;
export type InsertPremiumActivityEvent = z.infer<typeof insertPremiumActivityEventSchema>;

export const insertRewardedScoutBoostGrantSchema = createInsertSchema(
  rewardedScoutBoostGrants,
).omit({
  id: true,
  grantedAt: true,
  createdAt: true,
});

export type RewardedScoutBoostGrant = typeof rewardedScoutBoostGrants.$inferSelect;
export type InsertRewardedScoutBoostGrant = z.infer<typeof insertRewardedScoutBoostGrantSchema>;

// Community checkout session schemas and types
export const insertCommunityCheckoutSessionSchema = createInsertSchema(
  communityCheckoutSessions,
).omit({
  id: true,
  status: true,
  completedAt: true,
  createdAt: true,
});

export type CommunityCheckoutSession = typeof communityCheckoutSessions.$inferSelect;
export type InsertCommunityCheckoutSession = z.infer<typeof insertCommunityCheckoutSessionSchema>;

// Community order schemas and types
export const insertCommunityOrderSchema = createInsertSchema(communityOrders).omit({
  id: true,
  filledQuantity: true,
  status: true,
  createdAt: true,
});

export type CommunityOrder = typeof communityOrders.$inferSelect;
export type InsertCommunityOrder = z.infer<typeof insertCommunityOrderSchema>;

// Community trade schemas and types
export const insertCommunityTradeSchema = createInsertSchema(communityTrades).omit({
  id: true,
  executedAt: true,
});

export type CommunityTrade = typeof communityTrades.$inferSelect;
export type InsertCommunityTrade = z.infer<typeof insertCommunityTradeSchema>;

// Whop payment schemas and types
export const insertWhopPaymentSchema = createInsertSchema(whopPayments).omit({
  id: true,
  creditedAt: true,
  revokedAt: true,
  revokedQuantity: true,
  liabilityQuantity: true,
  createdAt: true,
});

export type WhopPayment = typeof whopPayments.$inferSelect;
export type InsertWhopPayment = z.infer<typeof insertWhopPaymentSchema>;

export const insertGooglePlayPurchaseSchema = createInsertSchema(googlePlayPurchases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type GooglePlayPurchase = typeof googlePlayPurchases.$inferSelect;
export type InsertGooglePlayPurchase = z.infer<typeof insertGooglePlayPurchaseSchema>;

// Tweet settings schemas and types
export const insertTweetSettingsSchema = createInsertSchema(tweetSettings).omit({
  id: true,
  updatedAt: true,
});

export type TweetSettings = typeof tweetSettings.$inferSelect;
export type InsertTweetSettings = z.infer<typeof insertTweetSettingsSchema>;

// Tweet history schemas and types
export const insertTweetHistorySchema = createInsertSchema(tweetHistory).omit({
  id: true,
  createdAt: true,
});

export const insertRedditPostHistorySchema = createInsertSchema(redditPostHistory).omit({
  id: true,
  postedAt: true,
  lastAttemptAt: true,
  createdAt: true,
  updatedAt: true,
});

export type TweetHistory = typeof tweetHistory.$inferSelect;
export type InsertTweetHistory = z.infer<typeof insertTweetHistorySchema>;

export type RedditPostHistory = typeof redditPostHistory.$inferSelect;
export type InsertRedditPostHistory = z.infer<typeof insertRedditPostHistorySchema>;

// News feed types
export type NewsFeed = typeof newsFeed.$inferSelect;

// Daily boosts schemas and types
export const insertDailyBoostSchema = createInsertSchema(dailyBoosts).omit({
  id: true,
  status: true,
  fantasyPoints: true,
  payout: true,
  createdAt: true,
  processedAt: true,
});

export type DailyBoost = typeof dailyBoosts.$inferSelect;
export type InsertDailyBoost = z.infer<typeof insertDailyBoostSchema>;

// Boost payouts schemas and types
export const insertBoostPayoutSchema = createInsertSchema(boostPayouts).omit({
  id: true,
  createdAt: true,
});

export type BoostPayout = typeof boostPayouts.$inferSelect;
export type InsertBoostPayout = z.infer<typeof insertBoostPayoutSchema>;

export const insertSharePayoutSchema = createInsertSchema(sharePayouts).omit({
  id: true,
  createdAt: true,
  processedAt: true,
});

export type SharePayout = typeof sharePayouts.$inferSelect;
export type InsertSharePayout = z.infer<typeof insertSharePayoutSchema>;

// Community boosts schemas and types
export const insertCommunityBoostSchema = createInsertSchema(communityBoosts).omit({
  id: true,
  status: true,
  fantasyPoints: true,
  totalPayout: true,
  beneficiaryCount: true,
  createdAt: true,
  processedAt: true,
});

export type CommunityBoost = typeof communityBoosts.$inferSelect;
export type InsertCommunityBoost = z.infer<typeof insertCommunityBoostSchema>;

// User Collections table - tracks player collection progress (team, rookie, position, allstar)
export const userCollections = pgTable(
  "user_collections",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectionType: varchar("collection_type", { length: 50 }).notNull(), // 'team', 'rookie', 'position', 'allstar'
    targetId: varchar("target_id").notNull(), // team abbreviation, position, etc.
    progress: integer("progress").notNull().default(0),
    total: integer("total").notNull(),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userTypeTargetIdx: uniqueIndex("user_collection_idx").on(
      table.userId,
      table.collectionType,
      table.targetId,
    ),
    userIdx: index("user_collections_user_idx").on(table.userId),
    completedIdx: index("user_collections_completed_idx").on(table.completed),
  }),
);

// Collections v2 — versioned factual definitions, transactional assembly, and public identity.
// The legacy userCollections table remains additive/read-only until the v2 backend cutover.
export const collectionDefinitions = pgTable(
  "collection_definitions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: varchar("slug", { length: 180 }).notNull(),
    sport: varchar("sport", { length: 20 }).notNull(),
    league: varchar("league", { length: 40 }).notNull(),
    season: varchar("season", { length: 20 }).notNull(),
    family: varchar("family", { length: 60 }).notNull(),
    kind: varchar("kind", { length: 30 }).notNull().default("player_slots"),
    lifecycleStatus: varchar("lifecycle_status", { length: 30 }).notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(1),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    finalizingAt: timestamp("finalizing_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex("collection_definitions_slug_unique").on(table.slug),
    catalogIdx: index("collection_definitions_catalog_idx").on(
      table.sport,
      table.season,
      table.family,
      table.lifecycleStatus,
    ),
    lifecycleIdx: index("collection_definitions_lifecycle_idx").on(table.lifecycleStatus),
    kindCheck: check(
      "collection_definitions_kind_check",
      sql`${table.kind} IN ('player_slots', 'master')`,
    ),
    lifecycleCheck: check(
      "collection_definitions_lifecycle_check",
      sql`${table.lifecycleStatus} IN ('draft', 'tracking', 'finalizing', 'final', 'disabled')`,
    ),
    currentVersionCheck: check(
      "collection_definitions_current_version_check",
      sql`${table.currentVersion} > 0`,
    ),
    disableCheck: check(
      "collection_definitions_disable_check",
      sql`(${table.lifecycleStatus} = 'disabled' AND ${table.disabledAt} IS NOT NULL)
          OR (${table.lifecycleStatus} <> 'disabled' AND ${table.disabledAt} IS NULL)`,
    ),
  }),
);

export const collectionDefinitionVersions = pgTable(
  "collection_definition_versions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    definitionId: varchar("definition_id")
      .notNull()
      .references(() => collectionDefinitions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    qualificationDescription: text("qualification_description").notNull(),
    qualificationRules: jsonb("qualification_rules")
      .notNull()
      .default(sql`'{}'::jsonb`),
    sourceType: varchar("source_type", { length: 60 }).notNull(),
    sourceUri: text("source_uri"),
    sourceMetadata: jsonb("source_metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    artKey: text("art_key").notNull(),
    state: varchar("state", { length: 30 }).notNull().default("draft"),
    correctionOfVersionId: varchar("correction_of_version_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    membershipLockedAt: timestamp("membership_locked_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    definitionVersionIdx: uniqueIndex("collection_versions_definition_version_unique").on(
      table.definitionId,
      table.version,
    ),
    stateIdx: index("collection_versions_state_idx").on(table.state, table.finalizedAt),
    correctionFk: foreignKey({
      name: "collection_versions_correction_fk",
      columns: [table.correctionOfVersionId],
      foreignColumns: [table.id],
    }).onDelete("restrict"),
    versionCheck: check("collection_versions_version_check", sql`${table.version} > 0`),
    stateCheck: check(
      "collection_versions_state_check",
      sql`${table.state} IN ('draft', 'tracking', 'final')`,
    ),
    finalCheck: check(
      "collection_versions_final_check",
      sql`(${table.state} = 'final' AND ${table.finalizedAt} IS NOT NULL) OR ${table.state} <> 'final'`,
    ),
  }),
);

export const collectionSlots = pgTable(
  "collection_slots",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    collectionVersionId: varchar("collection_version_id")
      .notNull()
      .references(() => collectionDefinitionVersions.id, { onDelete: "cascade" }),
    playerId: varchar("player_id").references(() => players.id),
    slotKey: varchar("slot_key", { length: 120 }).notNull(),
    slotLabel: text("slot_label").notNull(),
    requiredQuantity: decimal("required_quantity", { precision: 20, scale: 4 }).notNull(),
    isRequired: boolean("is_required").notNull().default(true),
    status: varchar("status", { length: 24 }).notNull().default("active"),
    rank: integer("rank"),
    statKey: varchar("stat_key", { length: 80 }),
    qualificationValue: decimal("qualification_value", { precision: 20, scale: 6 }),
    qualificationMetadata: jsonb("qualification_metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    displayOrder: integer("display_order").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionSlotIdx: uniqueIndex("collection_slots_version_key_unique").on(
      table.collectionVersionId,
      table.slotKey,
    ),
    versionOrderIdx: index("collection_slots_version_order_idx").on(
      table.collectionVersionId,
      table.displayOrder,
    ),
    playerIdx: index("collection_slots_player_idx").on(table.playerId, table.status),
    quantityCheck: check(
      "collection_slots_required_quantity_check",
      sql`${table.requiredQuantity} > 0`,
    ),
    statusCheck: check(
      "collection_slots_status_check",
      sql`${table.status} IN ('active', 'vacant', 'removed')`,
    ),
    activePlayerCheck: check(
      "collection_slots_active_player_check",
      sql`(${table.status} = 'active' AND ${table.playerId} IS NOT NULL)
          OR (${table.status} = 'vacant' AND ${table.playerId} IS NULL)
          OR ${table.status} = 'removed'`,
    ),
    removedCheck: check(
      "collection_slots_removed_check",
      sql`(${table.status} = 'removed' AND ${table.removedAt} IS NOT NULL)
          OR (${table.status} <> 'removed' AND ${table.removedAt} IS NULL)`,
    ),
    displayOrderCheck: check(
      "collection_slots_display_order_check",
      sql`${table.displayOrder} >= 0`,
    ),
    rankCheck: check(
      "collection_slots_rank_check",
      sql`${table.rank} IS NULL OR ${table.rank} > 0`,
    ),
  }),
);

export const collectionPrerequisites = pgTable(
  "collection_prerequisites",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    masterVersionId: varchar("master_version_id")
      .notNull()
      .references(() => collectionDefinitionVersions.id, { onDelete: "cascade" }),
    prerequisiteVersionId: varchar("prerequisite_version_id")
      .notNull()
      .references(() => collectionDefinitionVersions.id, { onDelete: "restrict" }),
    isRequired: boolean("is_required").notNull().default(true),
    displayOrder: integer("display_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    masterPrerequisiteIdx: uniqueIndex("collection_prerequisites_version_unique").on(
      table.masterVersionId,
      table.prerequisiteVersionId,
    ),
    prerequisiteIdx: index("collection_prerequisites_lookup_idx").on(table.prerequisiteVersionId),
    distinctCheck: check(
      "collection_prerequisites_not_self_check",
      sql`${table.masterVersionId} <> ${table.prerequisiteVersionId}`,
    ),
    displayOrderCheck: check(
      "collection_prerequisites_display_order_check",
      sql`${table.displayOrder} >= 0`,
    ),
  }),
);

export const userCollectionAllocations = pgTable(
  "user_collection_allocations",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectionSlotId: varchar("collection_slot_id")
      .notNull()
      .references(() => collectionSlots.id, { onDelete: "restrict" }),
    playerId: varchar("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    allocatedQuantity: decimal("allocated_quantity", { precision: 20, scale: 4 }).notNull(),
    lockReferenceId: varchar("lock_reference_id").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("active"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userSlotIdx: uniqueIndex("user_collection_allocations_user_slot_unique").on(
      table.userId,
      table.collectionSlotId,
    ),
    lockReferenceIdx: uniqueIndex("user_collection_allocations_lock_reference_unique").on(
      table.lockReferenceId,
    ),
    userStatusIdx: index("user_collection_allocations_user_status_idx").on(
      table.userId,
      table.status,
    ),
    playerStatusIdx: index("user_collection_allocations_player_status_idx").on(
      table.playerId,
      table.status,
    ),
    quantityCheck: check(
      "user_collection_allocations_quantity_check",
      sql`${table.allocatedQuantity} > 0`,
    ),
    statusCheck: check(
      "user_collection_allocations_status_check",
      sql`${table.status} IN ('active', 'released')`,
    ),
    releaseCheck: check(
      "user_collection_allocations_release_check",
      sql`(${table.status} = 'released' AND ${table.releasedAt} IS NOT NULL)
          OR (${table.status} = 'active' AND ${table.releasedAt} IS NULL)`,
    ),
  }),
);

export const userCollectionStates = pgTable(
  "user_collection_states",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectionDefinitionId: varchar("collection_definition_id")
      .notNull()
      .references(() => collectionDefinitions.id, { onDelete: "restrict" }),
    collectionVersionId: varchar("collection_version_id")
      .notNull()
      .references(() => collectionDefinitionVersions.id, { onDelete: "restrict" }),
    assemblyState: varchar("assembly_state", { length: 24 }).notNull().default("unstarted"),
    allocatedQuantity: decimal("allocated_quantity", { precision: 20, scale: 4 })
      .notNull()
      .default("0.0000"),
    requiredQuantity: decimal("required_quantity", { precision: 20, scale: 4 })
      .notNull()
      .default("0.0000"),
    qualifiedSlotCount: integer("qualified_slot_count").notNull().default(0),
    requiredSlotCount: integer("required_slot_count").notNull().default(0),
    progressBps: integer("progress_bps").notNull().default(0),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userVersionIdx: uniqueIndex("user_collection_states_user_version_unique").on(
      table.userId,
      table.collectionVersionId,
    ),
    userStateIdx: index("user_collection_states_user_state_idx").on(
      table.userId,
      table.assemblyState,
    ),
    activeDefinitionIdx: index("user_collection_states_active_definition_idx").on(
      table.collectionDefinitionId,
      table.assemblyState,
    ),
    stateCheck: check(
      "user_collection_states_assembly_check",
      sql`${table.assemblyState} IN ('unstarted', 'in_progress', 'ready', 'active', 'inactive')`,
    ),
    quantityCheck: check(
      "user_collection_states_quantity_check",
      sql`${table.allocatedQuantity} >= 0 AND ${table.requiredQuantity} >= 0`,
    ),
    slotsCheck: check(
      "user_collection_states_slots_check",
      sql`${table.qualifiedSlotCount} >= 0
          AND ${table.requiredSlotCount} >= 0
          AND ${table.qualifiedSlotCount} <= ${table.requiredSlotCount}`,
    ),
    progressCheck: check(
      "user_collection_states_progress_check",
      sql`${table.progressBps} BETWEEN 0 AND 10000`,
    ),
    readyCheck: check(
      "user_collection_states_ready_check",
      sql`${table.assemblyState} <> 'ready' OR ${table.readyAt} IS NOT NULL`,
    ),
    activeCheck: check(
      "user_collection_states_active_check",
      sql`${table.assemblyState} <> 'active' OR ${table.activatedAt} IS NOT NULL`,
    ),
  }),
);

export const userCollectionAwards = pgTable(
  "user_collection_awards",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectionDefinitionId: varchar("collection_definition_id")
      .notNull()
      .references(() => collectionDefinitions.id, { onDelete: "restrict" }),
    collectionVersionId: varchar("collection_version_id")
      .notNull()
      .references(() => collectionDefinitionVersions.id, { onDelete: "restrict" }),
    firstCompletedAt: timestamp("first_completed_at", { withTimezone: true }).notNull(),
    completionSequence: integer("completion_sequence"),
    raritySnapshot: jsonb("rarity_snapshot"),
    rewardMetadata: jsonb("reward_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userVersionIdx: uniqueIndex("user_collection_awards_user_version_unique").on(
      table.userId,
      table.collectionVersionId,
    ),
    trophyCaseIdx: index("user_collection_awards_trophy_case_idx").on(
      table.userId,
      table.firstCompletedAt,
    ),
    definitionIdx: index("user_collection_awards_definition_idx").on(
      table.collectionDefinitionId,
      table.firstCompletedAt,
    ),
    sequenceCheck: check(
      "user_collection_awards_sequence_check",
      sql`${table.completionSequence} IS NULL OR ${table.completionSequence} > 0`,
    ),
    rewardMetadataSizeCheck: check(
      "user_collection_awards_reward_metadata_size_check",
      sql`${table.rewardMetadata} IS NULL OR octet_length(${table.rewardMetadata}::text) <= 16384`,
    ),
  }),
);

export const userCollectionStateEvents = pgTable(
  "user_collection_state_events",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectionDefinitionId: varchar("collection_definition_id")
      .notNull()
      .references(() => collectionDefinitions.id, { onDelete: "restrict" }),
    collectionVersionId: varchar("collection_version_id")
      .notNull()
      .references(() => collectionDefinitionVersions.id, { onDelete: "restrict" }),
    eventType: varchar("event_type", { length: 40 }).notNull(),
    previousState: varchar("previous_state", { length: 24 }),
    nextState: varchar("next_state", { length: 24 }).notNull(),
    reason: varchar("reason", { length: 80 }).notNull(),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userOccurredIdx: index("user_collection_state_events_user_occurred_idx").on(
      table.userId,
      table.occurredAt,
    ),
    definitionOccurredIdx: index("user_collection_state_events_definition_occurred_idx").on(
      table.collectionDefinitionId,
      table.occurredAt,
    ),
    eventTypeCheck: check(
      "user_collection_state_events_type_check",
      sql`${table.eventType} IN ('progress_changed', 'ready', 'completed', 'deactivated', 'reactivated', 'membership_changed')`,
    ),
    previousStateCheck: check(
      "user_collection_state_events_previous_check",
      sql`${table.previousState} IS NULL OR ${table.previousState} IN ('unstarted', 'in_progress', 'ready', 'active', 'inactive')`,
    ),
    nextStateCheck: check(
      "user_collection_state_events_next_check",
      sql`${table.nextState} IN ('unstarted', 'in_progress', 'ready', 'active', 'inactive')`,
    ),
  }),
);

export const userBadgePreferences = pgTable(
  "user_badge_preferences",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectionDefinitionId: varchar("collection_definition_id")
      .notNull()
      .references(() => collectionDefinitions.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userDefinitionIdx: uniqueIndex("user_badge_preferences_definition_unique").on(
      table.userId,
      table.collectionDefinitionId,
    ),
    userPriorityIdx: uniqueIndex("user_badge_preferences_priority_unique").on(
      table.userId,
      table.priority,
    ),
    priorityCheck: check(
      "user_badge_preferences_priority_check",
      sql`${table.priority} BETWEEN 0 AND 4`,
    ),
  }),
);

export const userFeaturedCollections = pgTable(
  "user_featured_collections",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectionDefinitionId: varchar("collection_definition_id")
      .notNull()
      .references(() => collectionDefinitions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userDefinitionIdx: uniqueIndex("user_featured_collections_definition_unique").on(
      table.userId,
      table.collectionDefinitionId,
    ),
    userPositionIdx: uniqueIndex("user_featured_collections_position_unique").on(
      table.userId,
      table.position,
    ),
    positionCheck: check(
      "user_featured_collections_position_check",
      sql`${table.position} BETWEEN 0 AND 3`,
    ),
  }),
);

// User Milestones table - tracks net worth and achievement milestones
export const userMilestones = pgTable(
  "user_milestones",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    milestoneType: varchar("milestone_type", { length: 50 }).notNull(), // 'netWorth', 'portfolioValue', 'totalTrades'
    threshold: decimal("threshold", { precision: 20, scale: 2 }).notNull(),
    achievedAt: timestamp("achieved_at").notNull().defaultNow(),
    celebrated: boolean("celebrated").notNull().default(false),
  },
  (table) => ({
    userTypeThresholdIdx: uniqueIndex("user_milestone_idx").on(
      table.userId,
      table.milestoneType,
      table.threshold,
    ),
    userIdx: index("user_milestones_user_idx").on(table.userId),
    celebratedIdx: index("user_milestones_celebrated_idx").on(table.celebrated),
  }),
);

// Relations for new tables
export const userCollectionsRelations = relations(userCollections, ({ one }) => ({
  user: one(users, {
    fields: [userCollections.userId],
    references: [users.id],
  }),
}));

export const userMilestonesRelations = relations(userMilestones, ({ one }) => ({
  user: one(users, {
    fields: [userMilestones.userId],
    references: [users.id],
  }),
}));

export const userNotificationSettingsRelations = relations(userNotificationSettings, ({ one }) => ({
  user: one(users, {
    fields: [userNotificationSettings.userId],
    references: [users.id],
  }),
}));

export const userPushDevicesRelations = relations(userPushDevices, ({ one }) => ({
  user: one(users, {
    fields: [userPushDevices.userId],
    references: [users.id],
  }),
}));

export const accountDeletionRequestsRelations = relations(accountDeletionRequests, ({ one }) => ({
  user: one(users, {
    fields: [accountDeletionRequests.userId],
    references: [users.id],
  }),
}));

// Insert schemas for new tables
export const insertUserCollectionSchema = createInsertSchema(userCollections).omit({
  id: true,
  completed: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCollectionDefinitionSchema = createInsertSchema(collectionDefinitions).omit({
  id: true,
  lifecycleStatus: true,
  currentVersion: true,
  publishedAt: true,
  finalizingAt: true,
  finalizedAt: true,
  disabledAt: true,
  disabledReason: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCollectionDefinitionVersionSchema = createInsertSchema(
  collectionDefinitionVersions,
).omit({
  id: true,
  state: true,
  publishedAt: true,
  membershipLockedAt: true,
  finalizedAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCollectionSlotSchema = createInsertSchema(collectionSlots).omit({
  id: true,
  status: true,
  removedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCollectionPrerequisiteSchema = createInsertSchema(collectionPrerequisites).omit({
  id: true,
  createdAt: true,
});

export const insertUserCollectionAllocationSchema = createInsertSchema(
  userCollectionAllocations,
).omit({
  id: true,
  status: true,
  releasedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserCollectionStateSchema = createInsertSchema(userCollectionStates).omit({
  id: true,
  readyAt: true,
  activatedAt: true,
  deactivatedAt: true,
  evaluatedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserCollectionAwardSchema = createInsertSchema(userCollectionAwards).omit({
  id: true,
  createdAt: true,
});

export const insertUserCollectionStateEventSchema = createInsertSchema(
  userCollectionStateEvents,
).omit({
  id: true,
  occurredAt: true,
});

export const insertUserBadgePreferenceSchema = createInsertSchema(userBadgePreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserFeaturedCollectionSchema = createInsertSchema(userFeaturedCollections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserMilestoneSchema = createInsertSchema(userMilestones).omit({
  id: true,
  achievedAt: true,
  celebrated: true,
});

export const insertUserNotificationSettingsSchema = createInsertSchema(
  userNotificationSettings,
).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertUserPushDeviceSchema = createInsertSchema(userPushDevices).omit({
  id: true,
  lastSeenAt: true,
  invalidatedAt: true,
  invalidReason: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAccountDeletionRequestSchema = createInsertSchema(accountDeletionRequests).omit({
  id: true,
  status: true,
  requestedAt: true,
  cancelledAt: true,
  processedAt: true,
});

// Types for new tables
export type UserCollection = typeof userCollections.$inferSelect;
export type InsertUserCollection = z.infer<typeof insertUserCollectionSchema>;

export type CollectionDefinition = typeof collectionDefinitions.$inferSelect;
export type InsertCollectionDefinition = z.infer<typeof insertCollectionDefinitionSchema>;
export type CollectionDefinitionVersion = typeof collectionDefinitionVersions.$inferSelect;
export type InsertCollectionDefinitionVersion = z.infer<
  typeof insertCollectionDefinitionVersionSchema
>;
export type CollectionSlot = typeof collectionSlots.$inferSelect;
export type InsertCollectionSlot = z.infer<typeof insertCollectionSlotSchema>;
export type CollectionPrerequisite = typeof collectionPrerequisites.$inferSelect;
export type InsertCollectionPrerequisite = z.infer<typeof insertCollectionPrerequisiteSchema>;
export type UserCollectionAllocation = typeof userCollectionAllocations.$inferSelect;
export type InsertUserCollectionAllocation = z.infer<typeof insertUserCollectionAllocationSchema>;
export type UserCollectionState = typeof userCollectionStates.$inferSelect;
export type InsertUserCollectionState = z.infer<typeof insertUserCollectionStateSchema>;
export type UserCollectionAward = typeof userCollectionAwards.$inferSelect;
export type InsertUserCollectionAward = z.infer<typeof insertUserCollectionAwardSchema>;
export type UserCollectionStateEvent = typeof userCollectionStateEvents.$inferSelect;
export type InsertUserCollectionStateEvent = z.infer<typeof insertUserCollectionStateEventSchema>;
export type UserBadgePreference = typeof userBadgePreferences.$inferSelect;
export type InsertUserBadgePreference = z.infer<typeof insertUserBadgePreferenceSchema>;
export type UserFeaturedCollection = typeof userFeaturedCollections.$inferSelect;
export type InsertUserFeaturedCollection = z.infer<typeof insertUserFeaturedCollectionSchema>;

export type UserMilestone = typeof userMilestones.$inferSelect;
export type InsertUserMilestone = z.infer<typeof insertUserMilestoneSchema>;

export type UserNotificationSettings = typeof userNotificationSettings.$inferSelect;
export type InsertUserNotificationSettings = z.infer<typeof insertUserNotificationSettingsSchema>;

export type UserPushDevice = typeof userPushDevices.$inferSelect;
export type InsertUserPushDevice = z.infer<typeof insertUserPushDeviceSchema>;

export type AccountDeletionRequest = typeof accountDeletionRequests.$inferSelect;
export type InsertAccountDeletionRequest = z.infer<typeof insertAccountDeletionRequestSchema>;

// AMM Pool types
export type PlayerPool = typeof playerPools.$inferSelect;
export type InsertPlayerPool = z.infer<typeof insertPlayerPoolSchema>;

// LP types
export type LpPosition = typeof lpPositions.$inferSelect;
export type InsertLpPosition = z.infer<typeof insertLpPositionSchema>;

export type LpTransaction = typeof lpTransactions.$inferSelect;
export type InsertLpTransaction = z.infer<typeof insertLpTransactionSchema>;

export const insertUserApiTokenSchema = createInsertSchema(userApiTokens).omit({
  id: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
});

export type UserApiToken = typeof userApiTokens.$inferSelect;
export type InsertUserApiToken = z.infer<typeof insertUserApiTokenSchema>;

export const insertUserPushTokenSchema = createInsertSchema(userPushTokens).omit({
  id: true,
  lastRegisteredAt: true,
  lastSuccessfulAt: true,
  lastFailureAt: true,
  failureCount: true,
  invalidatedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserNotificationPreferenceSchema = createInsertSchema(
  userNotificationPreferences,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPushNotificationEventSchema = createInsertSchema(pushNotificationEvents).omit({
  id: true,
  sentAt: true,
  createdAt: true,
  updatedAt: true,
});

export type UserPushToken = typeof userPushTokens.$inferSelect;
export type InsertUserPushToken = z.infer<typeof insertUserPushTokenSchema>;

export type UserNotificationPreference = typeof userNotificationPreferences.$inferSelect;
export type InsertUserNotificationPreference = z.infer<
  typeof insertUserNotificationPreferenceSchema
>;

export type PushNotificationEvent = typeof pushNotificationEvents.$inferSelect;
export type InsertPushNotificationEvent = z.infer<typeof insertPushNotificationEventSchema>;

export const insertDiscordUserLinkSchema = createInsertSchema(discordUserLinks).omit({
  id: true,
  linkedAt: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDiscordLinkStateSchema = createInsertSchema(discordLinkStates).omit({
  id: true,
  consumedAt: true,
  createdAt: true,
});

export const insertDiscordTradeIntentSchema = createInsertSchema(discordTradeIntents).omit({
  id: true,
  consumedAt: true,
  createdAt: true,
});

export const insertDiscordPostHistorySchema = createInsertSchema(discordPostHistory).omit({
  id: true,
  postedAt: true,
  createdAt: true,
});

export const insertDiscordReportSyncSchema = createInsertSchema(discordReportSyncs).omit({
  id: true,
  lastSyncedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type DiscordUserLink = typeof discordUserLinks.$inferSelect;
export type InsertDiscordUserLink = z.infer<typeof insertDiscordUserLinkSchema>;

export type DiscordLinkState = typeof discordLinkStates.$inferSelect;
export type InsertDiscordLinkState = z.infer<typeof insertDiscordLinkStateSchema>;

export type DiscordTradeIntent = typeof discordTradeIntents.$inferSelect;
export type InsertDiscordTradeIntent = z.infer<typeof insertDiscordTradeIntentSchema>;

export type DiscordPostHistory = typeof discordPostHistory.$inferSelect;
export type InsertDiscordPostHistory = z.infer<typeof insertDiscordPostHistorySchema>;

export type DiscordReportSync = typeof discordReportSyncs.$inferSelect;
export type InsertDiscordReportSync = z.infer<typeof insertDiscordReportSyncSchema>;
