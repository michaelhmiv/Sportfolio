CREATE TABLE IF NOT EXISTS "scout_history" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "player_id" varchar NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
    "scout_count" integer NOT NULL,
    "started_at" timestamp DEFAULT now() NOT NULL,
    "ended_at" timestamp
);

CREATE INDEX IF NOT EXISTS "scout_history_user_time_idx" ON "scout_history" ("user_id", "started_at", "ended_at");
CREATE INDEX IF NOT EXISTS "scout_history_player_time_idx" ON "scout_history" ("player_id", "started_at", "ended_at");
