CREATE TABLE IF NOT EXISTS "agent_skills" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "scope" text NOT NULL,
  "user_id" varchar REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "trigger_examples" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "tool_sequence" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "clarification_strategy" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "constraints" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "confidence" numeric(4, 3) NOT NULL DEFAULT 0.500,
  "status" text NOT NULL,
  "source_thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "archived_at" timestamp
);

CREATE INDEX IF NOT EXISTS "agent_skills_user_status_updated_idx"
  ON "agent_skills" ("user_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "agent_skills_scope_status_updated_idx"
  ON "agent_skills" ("scope", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "agent_skills_status_updated_idx"
  ON "agent_skills" ("status", "updated_at");

CREATE TABLE IF NOT EXISTS "agent_skill_reviews" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "skill_id" varchar NOT NULL REFERENCES "agent_skills"("id") ON DELETE CASCADE,
  "reviewed_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "decision" text NOT NULL,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_skill_reviews_skill_idx"
  ON "agent_skill_reviews" ("skill_id");

CREATE INDEX IF NOT EXISTS "agent_skill_reviews_reviewer_idx"
  ON "agent_skill_reviews" ("reviewed_by", "created_at");
