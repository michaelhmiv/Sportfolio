CREATE TABLE IF NOT EXISTS "user_api_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "label" text NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" varchar(32) NOT NULL,
  "token_last4" varchar(4) NOT NULL,
  "last_used_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_api_tokens_hash_idx" ON "user_api_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "user_api_tokens_user_idx" ON "user_api_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "user_api_tokens_active_idx" ON "user_api_tokens" ("user_id", "revoked_at");
