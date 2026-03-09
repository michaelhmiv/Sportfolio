CREATE TABLE IF NOT EXISTS "premium_activity_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "quantity_delta" integer NOT NULL DEFAULT 0,
  "amount_cents" integer,
  "days_granted" integer,
  "premium_expires_at_after" timestamp,
  "reference_id" varchar,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "premium_activity_user_created_idx"
  ON "premium_activity_events" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "premium_activity_event_type_idx"
  ON "premium_activity_events" ("event_type");

CREATE UNIQUE INDEX IF NOT EXISTS "premium_activity_event_ref_idx"
  ON "premium_activity_events" ("event_type", "reference_id");
