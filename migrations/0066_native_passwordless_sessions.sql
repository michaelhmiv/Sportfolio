-- Native passwordless handoff bearer sessions.
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
