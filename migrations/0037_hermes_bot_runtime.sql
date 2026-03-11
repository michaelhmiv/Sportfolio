ALTER TABLE "bot_profiles"
  ADD COLUMN IF NOT EXISTS "strategy_prompt" text NOT NULL DEFAULT '';

ALTER TABLE "bot_profiles"
  ADD COLUMN IF NOT EXISTS "allowed_mechanics" text[] NOT NULL DEFAULT ARRAY['market','liquidity','scouting','boosts']::text[];

ALTER TABLE "bot_profiles"
  ADD COLUMN IF NOT EXISTS "objective_weights" jsonb NOT NULL DEFAULT '{"priceMovement":0.45,"liquidityCoverage":0.35,"variety":0.20}'::jsonb;

ALTER TABLE "bot_profiles"
  ADD COLUMN IF NOT EXISTS "research_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "bot_profiles"
  ADD COLUMN IF NOT EXISTS "research_query_budget" integer NOT NULL DEFAULT 1;

ALTER TABLE "bot_profiles"
  ADD COLUMN IF NOT EXISTS "research_ttl_minutes" integer NOT NULL DEFAULT 90;

ALTER TABLE "bot_profiles"
  ADD COLUMN IF NOT EXISTS "max_actions_per_tick" integer NOT NULL DEFAULT 2;

ALTER TABLE "bot_profiles"
  ADD COLUMN IF NOT EXISTS "max_player_exposure_percent" numeric(5, 2) NOT NULL DEFAULT 25.00;

CREATE TABLE IF NOT EXISTS "bot_cycle_briefs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "cycle_key" text NOT NULL UNIQUE,
  "coordinator_bot_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'ready',
  "summary" text NOT NULL,
  "shared_prompt" text NOT NULL,
  "brief_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "citations" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "tool_trace" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "used_research" boolean NOT NULL DEFAULT false,
  "research_query_count" integer NOT NULL DEFAULT 0,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "bot_cycle_briefs_expires_idx"
  ON "bot_cycle_briefs" ("expires_at");

CREATE INDEX IF NOT EXISTS "bot_cycle_briefs_created_idx"
  ON "bot_cycle_briefs" ("created_at");

CREATE TABLE IF NOT EXISTS "bot_run_logs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "cycle_key" text NOT NULL,
  "bot_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "bot_profile_id" varchar NOT NULL REFERENCES "bot_profiles"("id") ON DELETE CASCADE,
  "cycle_brief_id" varchar REFERENCES "bot_cycle_briefs"("id") ON DELETE SET NULL,
  "thread_id" varchar,
  "status" text NOT NULL DEFAULT 'pending',
  "role" text NOT NULL,
  "summary" text,
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "planned_actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "executed_actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "citations" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "tool_trace" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "used_research" boolean NOT NULL DEFAULT false,
  "research_query_count" integer NOT NULL DEFAULT 0,
  "error_message" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "bot_run_logs_bot_created_idx"
  ON "bot_run_logs" ("bot_user_id", "created_at");

CREATE INDEX IF NOT EXISTS "bot_run_logs_cycle_idx"
  ON "bot_run_logs" ("cycle_key");

CREATE INDEX IF NOT EXISTS "bot_run_logs_status_idx"
  ON "bot_run_logs" ("status");
