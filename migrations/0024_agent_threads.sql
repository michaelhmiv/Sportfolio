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
