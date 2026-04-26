CREATE TABLE IF NOT EXISTS "user_notification_settings" (
  "user_id" varchar PRIMARY KEY REFERENCES "users"("id") ON DELETE cascade,
  "push_enabled" boolean NOT NULL DEFAULT true,
  "category_preferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "user_notification_settings_push_enabled_idx"
  ON "user_notification_settings" ("push_enabled");
CREATE INDEX IF NOT EXISTS "user_notification_settings_updated_at_idx"
  ON "user_notification_settings" ("updated_at");

CREATE TABLE IF NOT EXISTS "user_push_devices" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "platform" text NOT NULL DEFAULT 'android',
  "token" text NOT NULL,
  "device_id" varchar(128),
  "app_version" varchar(64),
  "permission_status" text NOT NULL DEFAULT 'unknown',
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "enabled" boolean NOT NULL DEFAULT true,
  "invalidated_at" timestamp,
  "invalid_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_push_devices_token_idx"
  ON "user_push_devices" ("token");
CREATE INDEX IF NOT EXISTS "user_push_devices_user_idx"
  ON "user_push_devices" ("user_id");
CREATE INDEX IF NOT EXISTS "user_push_devices_user_enabled_idx"
  ON "user_push_devices" ("user_id", "enabled", "invalidated_at");
CREATE INDEX IF NOT EXISTS "user_push_devices_device_idx"
  ON "user_push_devices" ("device_id");
CREATE INDEX IF NOT EXISTS "user_push_devices_permission_idx"
  ON "user_push_devices" ("permission_status");

INSERT INTO "user_notification_settings" (
  "user_id",
  "push_enabled",
  "category_preferences",
  "created_at",
  "updated_at"
)
SELECT
  u.id,
  true,
  CASE
    WHEN u.news_notifications_enabled = false
      THEN jsonb_build_object('player_news', false, 'daily_digest', false)
    ELSE '{}'::jsonb
  END,
  now(),
  now()
FROM "users" u
ON CONFLICT ("user_id") DO NOTHING;
