ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "status" text NOT NULL DEFAULT 'pending',
  "reason" text,
  "details" text,
  "requested_at" timestamp NOT NULL DEFAULT now(),
  "effective_at" timestamp NOT NULL,
  "cancelled_at" timestamp,
  "processed_at" timestamp,
  "retained_records_note" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS "account_deletion_requests_user_status_idx"
  ON "account_deletion_requests" ("user_id", "status");

CREATE INDEX IF NOT EXISTS "account_deletion_requests_effective_idx"
  ON "account_deletion_requests" ("status", "effective_at");

CREATE INDEX IF NOT EXISTS "account_deletion_requests_requested_idx"
  ON "account_deletion_requests" ("requested_at");
