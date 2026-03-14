CREATE TABLE IF NOT EXISTS "player_id_aliases" (
  "alias_player_id" varchar PRIMARY KEY,
  "canonical_player_id" varchar NOT NULL REFERENCES "public"."players"("id") ON DELETE CASCADE,
  "sport" text NOT NULL,
  "reason" text NOT NULL DEFAULT 'duplicate_merge',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_id_aliases_canonical_idx"
  ON "player_id_aliases" ("canonical_player_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_id_aliases_sport_canonical_idx"
  ON "player_id_aliases" ("sport", "canonical_player_id");
--> statement-breakpoint
ALTER TABLE "player_id_aliases" ENABLE ROW LEVEL SECURITY;
