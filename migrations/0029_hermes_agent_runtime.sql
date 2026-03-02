ALTER TABLE "user_agent_profiles"
  ADD COLUMN IF NOT EXISTS "runtime" text NOT NULL DEFAULT 'hermes';

CREATE INDEX IF NOT EXISTS "user_agent_profiles_runtime_idx"
  ON "user_agent_profiles" ("runtime");

CREATE TABLE IF NOT EXISTS "user_agent_memories" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE SET NULL,
  "scope" text NOT NULL,
  "kind" text NOT NULL,
  "summary" text NOT NULL,
  "content" jsonb NOT NULL,
  "confidence" numeric(4, 3) NOT NULL DEFAULT 0.500,
  "source" text NOT NULL,
  "embedding" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "archived_at" timestamp
);

CREATE INDEX IF NOT EXISTS "user_agent_memories_user_scope_updated_idx"
  ON "user_agent_memories" ("user_id", "scope", "updated_at");

CREATE INDEX IF NOT EXISTS "user_agent_memories_user_kind_updated_idx"
  ON "user_agent_memories" ("user_id", "kind", "updated_at");

CREATE INDEX IF NOT EXISTS "user_agent_memories_thread_idx"
  ON "user_agent_memories" ("thread_id");

CREATE INDEX IF NOT EXISTS "user_agent_memories_active_idx"
  ON "user_agent_memories" ("user_id", "archived_at");

CREATE TABLE IF NOT EXISTS "agent_runtime_sessions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE SET NULL,
  "runtime" text NOT NULL,
  "status" text NOT NULL,
  "request_payload" jsonb,
  "response_payload" jsonb,
  "tool_trace" jsonb,
  "latency_ms" integer,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_runtime_sessions_user_created_idx"
  ON "agent_runtime_sessions" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "agent_runtime_sessions_thread_created_idx"
  ON "agent_runtime_sessions" ("thread_id", "created_at");

CREATE INDEX IF NOT EXISTS "agent_runtime_sessions_runtime_created_idx"
  ON "agent_runtime_sessions" ("runtime", "created_at");
