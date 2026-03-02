CREATE TABLE IF NOT EXISTS "user_agent_profiles" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT true,
  "display_name" text NOT NULL DEFAULT 'My Scout Agent',
  "provider_mode" text NOT NULL DEFAULT 'managed',
  "provider_type" text NOT NULL DEFAULT 'openai_compatible',
  "model" text NOT NULL DEFAULT 'managed-default',
  "base_url" text,
  "system_prompt" text NOT NULL DEFAULT 'Operate like a sharp Sportfolio scout strategist. Stay grounded in the provided Sportfolio context, focus on scouting only, surface the strongest opportunity and risk tradeoffs clearly, and never invent players, schedules, or actions outside scout_set_count.',
  "user_prompt_template" text NOT NULL DEFAULT 'Act like my scout GM. Give me clear, curated reads on my current scout setup, call out concentration risk and missed opportunities, and when I ask for a move, translate that into the highest-leverage scout reallocation you can support with the current Sportfolio context.',
  "temperature" numeric(3, 2) NOT NULL DEFAULT 0.20,
  "max_tokens" integer NOT NULL DEFAULT 1200,
  "analysis_window_minutes" integer NOT NULL DEFAULT 1440,
  "default_sport" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_agent_secrets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "api_key_ciphertext" text NOT NULL,
  "api_key_iv" text NOT NULL,
  "api_key_auth_tag" text NOT NULL,
  "key_last4" text NOT NULL,
  "encryption_version" text NOT NULL DEFAULT 'aes-256-gcm:v1',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "rotated_at" timestamp
);

CREATE TABLE IF NOT EXISTS "user_agent_runs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "trigger_source" text NOT NULL DEFAULT 'manual',
  "status" text NOT NULL DEFAULT 'pending',
  "provider_mode" text NOT NULL DEFAULT 'managed',
  "model" text NOT NULL,
  "context_snapshot" jsonb NOT NULL,
  "prompt_snapshot" jsonb NOT NULL,
  "raw_response" jsonb,
  "parsed_summary" text,
  "error_message" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp
);

CREATE TABLE IF NOT EXISTS "user_agent_proposals" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" varchar NOT NULL REFERENCES "user_agent_runs"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "action_type" text NOT NULL DEFAULT 'scout_set_count',
  "status" text NOT NULL DEFAULT 'proposed',
  "player_id" varchar REFERENCES "players"("id") ON DELETE NO ACTION,
  "target_count" integer,
  "current_count" integer,
  "reasoning" text NOT NULL,
  "confidence" numeric(4, 3) NOT NULL DEFAULT 0.500,
  "evidence" jsonb NOT NULL,
  "risk_flags" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "approved_at" timestamp,
  "applied_at" timestamp,
  "error_message" text
);

CREATE TABLE IF NOT EXISTS "user_agent_threads" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "channel" text NOT NULL DEFAULT 'in_app',
  "domain" text NOT NULL DEFAULT 'scouting',
  "status" text NOT NULL DEFAULT 'active',
  "title" text,
  "external_thread_key" text,
  "last_message_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "user_agent_runs"
  ADD COLUMN IF NOT EXISTS "thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "user_agent_action_bundles" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "thread_id" varchar NOT NULL REFERENCES "user_agent_threads"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "domain" text NOT NULL DEFAULT 'scouting',
  "run_id" varchar REFERENCES "user_agent_runs"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'pending_confirmation',
  "summary" text NOT NULL,
  "warnings" jsonb NOT NULL,
  "action_payload" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "confirmed_at" timestamp,
  "applied_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_agent_messages" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "thread_id" varchar NOT NULL REFERENCES "user_agent_threads"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "message_type" text NOT NULL DEFAULT 'chat',
  "content_text" text NOT NULL,
  "structured_payload" jsonb,
  "run_id" varchar REFERENCES "user_agent_runs"("id") ON DELETE SET NULL,
  "action_bundle_id" varchar REFERENCES "user_agent_action_bundles"("id") ON DELETE SET NULL,
  "external_message_key" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "user_agent_threads_user_updated_idx"
  ON "user_agent_threads" ("user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "user_agent_threads_user_status_idx"
  ON "user_agent_threads" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "user_agent_threads_channel_idx"
  ON "user_agent_threads" ("channel");
CREATE UNIQUE INDEX IF NOT EXISTS "user_agent_profiles_user_idx"
  ON "user_agent_profiles" ("user_id");
CREATE INDEX IF NOT EXISTS "user_agent_profiles_provider_mode_idx"
  ON "user_agent_profiles" ("provider_mode");
CREATE INDEX IF NOT EXISTS "user_agent_profiles_updated_at_idx"
  ON "user_agent_profiles" ("updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "user_agent_secrets_user_idx"
  ON "user_agent_secrets" ("user_id");
CREATE INDEX IF NOT EXISTS "user_agent_secrets_updated_at_idx"
  ON "user_agent_secrets" ("updated_at");
CREATE INDEX IF NOT EXISTS "user_agent_runs_user_created_idx"
  ON "user_agent_runs" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "user_agent_runs_status_idx"
  ON "user_agent_runs" ("status");
CREATE INDEX IF NOT EXISTS "user_agent_proposals_run_idx"
  ON "user_agent_proposals" ("run_id");
CREATE INDEX IF NOT EXISTS "user_agent_proposals_user_status_created_idx"
  ON "user_agent_proposals" ("user_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "user_agent_runs_thread_created_idx"
  ON "user_agent_runs" ("thread_id", "created_at");

CREATE INDEX IF NOT EXISTS "user_agent_action_bundles_thread_status_idx"
  ON "user_agent_action_bundles" ("thread_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "user_agent_action_bundles_user_created_idx"
  ON "user_agent_action_bundles" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "user_agent_messages_thread_created_idx"
  ON "user_agent_messages" ("thread_id", "created_at");
CREATE INDEX IF NOT EXISTS "user_agent_messages_user_created_idx"
  ON "user_agent_messages" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "user_agent_messages_action_bundle_idx"
  ON "user_agent_messages" ("action_bundle_id");
