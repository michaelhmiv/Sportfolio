CREATE TABLE IF NOT EXISTS "user_push_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "platform" text NOT NULL DEFAULT 'android',
  "token" text NOT NULL,
  "device_id" text,
  "app_version" text,
  "os_version" text,
  "device_model" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_registered_at" timestamp NOT NULL DEFAULT now(),
  "last_successful_at" timestamp,
  "last_failure_at" timestamp,
  "failure_count" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "invalidated_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "user_push_tokens_user_idx"
  ON "user_push_tokens" ("user_id");

CREATE INDEX IF NOT EXISTS "user_push_tokens_user_platform_active_idx"
  ON "user_push_tokens" ("user_id", "platform", "is_active");

CREATE UNIQUE INDEX IF NOT EXISTS "user_push_tokens_token_idx"
  ON "user_push_tokens" ("token");

CREATE INDEX IF NOT EXISTS "user_push_tokens_device_idx"
  ON "user_push_tokens" ("user_id", "platform", "device_id");

CREATE TABLE IF NOT EXISTS "user_notification_preferences" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "notification_type" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_notification_prefs_user_type_idx"
  ON "user_notification_preferences" ("user_id", "notification_type");

CREATE INDEX IF NOT EXISTS "user_notification_prefs_user_idx"
  ON "user_notification_preferences" ("user_id");

CREATE TABLE IF NOT EXISTS "push_notification_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "notification_type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "route" text NOT NULL DEFAULT '/',
  "entity_type" text,
  "entity_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "delivery_status" text NOT NULL DEFAULT 'pending',
  "provider" text NOT NULL DEFAULT 'firebase',
  "provider_message_id" text,
  "dedupe_key" text,
  "sent_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "push_notification_events_user_created_idx"
  ON "push_notification_events" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "push_notification_events_type_created_idx"
  ON "push_notification_events" ("notification_type", "created_at");

CREATE INDEX IF NOT EXISTS "push_notification_events_status_idx"
  ON "push_notification_events" ("delivery_status");

CREATE UNIQUE INDEX IF NOT EXISTS "push_notification_events_user_dedupe_idx"
  ON "push_notification_events" ("user_id", "dedupe_key");
