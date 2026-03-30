CREATE TABLE IF NOT EXISTS "rewarded_scout_boost_grants" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "platform" text NOT NULL DEFAULT 'android',
  "ad_network" text NOT NULL DEFAULT 'admob',
  "ad_unit_id" text,
  "reward_item" text,
  "reward_amount" integer,
  "reward_session_id" varchar NOT NULL,
  "transaction_id" varchar NOT NULL,
  "custom_data" text,
  "rewarded_at" timestamp NOT NULL,
  "granted_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "rewarded_scout_boost_user_expires_idx"
  ON "rewarded_scout_boost_grants" ("user_id", "expires_at");

CREATE INDEX IF NOT EXISTS "rewarded_scout_boost_session_idx"
  ON "rewarded_scout_boost_grants" ("reward_session_id");

CREATE UNIQUE INDEX IF NOT EXISTS "rewarded_scout_boost_transaction_idx"
  ON "rewarded_scout_boost_grants" ("transaction_id");
