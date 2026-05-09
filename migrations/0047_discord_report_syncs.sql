CREATE TABLE IF NOT EXISTS "discord_report_syncs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "thread_channel_id" varchar(32) NOT NULL,
  "parent_channel_id" varchar(32) NOT NULL,
  "report_type" text NOT NULL,
  "thread_name" text,
  "github_owner" text NOT NULL,
  "github_repo" text NOT NULL,
  "github_issue_number" integer NOT NULL,
  "github_issue_url" text NOT NULL,
  "created_by_discord_user_id" varchar(32),
  "last_synced_message_id" varchar(32),
  "last_synced_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "discord_report_syncs_thread_idx"
  ON "discord_report_syncs" ("thread_channel_id");
CREATE UNIQUE INDEX IF NOT EXISTS "discord_report_syncs_issue_idx"
  ON "discord_report_syncs" ("github_owner", "github_repo", "github_issue_number");
CREATE INDEX IF NOT EXISTS "discord_report_syncs_type_idx"
  ON "discord_report_syncs" ("report_type", "created_at");
