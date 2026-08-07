-- Better Auth OAuth 2.1 provider + JWT/JWKS schema (pinned runtime 1.6.25).
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
