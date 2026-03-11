ALTER TABLE "bot_run_logs"
  ADD COLUMN IF NOT EXISTS "failure_class" text;

ALTER TABLE "bot_run_logs"
  ADD COLUMN IF NOT EXISTS "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS "bot_run_logs_failure_class_idx"
  ON "bot_run_logs" ("failure_class");
