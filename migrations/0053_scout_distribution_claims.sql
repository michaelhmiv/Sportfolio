-- Durable idempotency claims for hourly scout distributions.
-- This intentionally does not add uniqueness to the historically duplicated ledger.
CREATE TABLE "scout_distribution_claims" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "hour_timestamp" timestamp NOT NULL,
  "player_id" varchar NOT NULL REFERENCES "players"("id"),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "scout_distribution_claims_event_idx"
  ON "scout_distribution_claims" ("hour_timestamp", "player_id", "user_id");

-- Claim every historical natural key, including groups with duplicate ledger rows.
INSERT INTO "scout_distribution_claims" (
  "hour_timestamp",
  "player_id",
  "user_id",
  "created_at"
)
SELECT
  "hour_timestamp",
  "player_id",
  "user_id",
  MIN("created_at")
FROM "scout_distributions"
GROUP BY "hour_timestamp", "player_id", "user_id"
ON CONFLICT ("hour_timestamp", "player_id", "user_id") DO NOTHING;
