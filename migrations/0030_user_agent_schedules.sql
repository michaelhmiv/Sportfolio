CREATE TABLE IF NOT EXISTS "user_agent_schedules" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "job_type" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "schedule_cron" text NOT NULL,
  "channel_targets" jsonb NOT NULL DEFAULT '["in_app"]'::jsonb,
  "policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_run_at" timestamp,
  "next_run_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_agent_schedules_user_job_idx"
  ON "user_agent_schedules" ("user_id", "job_type");

CREATE INDEX IF NOT EXISTS "user_agent_schedules_due_run_idx"
  ON "user_agent_schedules" ("enabled", "next_run_at");

CREATE INDEX IF NOT EXISTS "user_agent_schedules_user_updated_idx"
  ON "user_agent_schedules" ("user_id", "updated_at");
