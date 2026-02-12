CREATE TABLE IF NOT EXISTS "share_payouts" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL,
  "player_id" varchar NOT NULL,
  "game_id" text NOT NULL,
  "share_power" numeric(12, 2) NOT NULL,
  "base_rate" numeric(10, 4) DEFAULT '1.0000' NOT NULL,
  "fantasy_points" numeric(10, 2),
  "payout_amount" numeric(20, 2),
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "processed_at" timestamp
);

ALTER TABLE "share_payouts"
  ADD CONSTRAINT "share_payouts_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "share_payouts"
  ADD CONSTRAINT "share_payouts_player_id_players_id_fk"
  FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "share_payout_user_idx" ON "share_payouts" ("user_id");
CREATE INDEX IF NOT EXISTS "share_payout_game_idx" ON "share_payouts" ("game_id");
CREATE INDEX IF NOT EXISTS "share_payout_status_idx" ON "share_payouts" ("status");
CREATE INDEX IF NOT EXISTS "share_payout_created_idx" ON "share_payouts" ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "share_payout_user_player_game_idx"
  ON "share_payouts" ("user_id", "player_id", "game_id");
