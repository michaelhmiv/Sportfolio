CREATE TABLE IF NOT EXISTS "user_phone_links" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "phone_e164" varchar(20) NOT NULL,
  "normalized_phone" varchar(20) NOT NULL,
  "verified_at" timestamp,
  "linked_at" timestamp NOT NULL DEFAULT now(),
  "last_inbound_at" timestamp,
  "last_outbound_at" timestamp,
  "sms_enabled" boolean NOT NULL DEFAULT true,
  "sms_opt_in_status" text NOT NULL DEFAULT 'pending',
  "sms_opt_in_source" text,
  "sms_opted_out_at" timestamp,
  "sms_last_stop_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_phone_links_user_idx" ON "user_phone_links" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "user_phone_links_phone_idx" ON "user_phone_links" ("normalized_phone");
CREATE INDEX IF NOT EXISTS "user_phone_links_status_idx" ON "user_phone_links" ("sms_opt_in_status", "sms_enabled");

CREATE TABLE IF NOT EXISTS "user_phone_link_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "phone_e164" varchar(20) NOT NULL,
  "token_hash" text NOT NULL,
  "purpose" text NOT NULL DEFAULT 'signup_or_link',
  "expires_at" timestamp NOT NULL,
  "claimed_by_user_id" varchar REFERENCES "users"("id") ON DELETE set null,
  "consumed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_phone_link_tokens_hash_idx" ON "user_phone_link_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "user_phone_link_tokens_phone_idx" ON "user_phone_link_tokens" ("phone_e164");
CREATE INDEX IF NOT EXISTS "user_phone_link_tokens_expiry_idx" ON "user_phone_link_tokens" ("expires_at");

CREATE TABLE IF NOT EXISTS "sms_message_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "phone_e164" varchar(20) NOT NULL,
  "direction" text NOT NULL,
  "provider" text NOT NULL DEFAULT 'telnyx',
  "provider_event_id" text,
  "provider_message_id" text,
  "user_id" varchar REFERENCES "users"("id") ON DELETE set null,
  "agent_thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE set null,
  "event_type" text NOT NULL DEFAULT 'message',
  "message_text" text,
  "structured_payload" jsonb,
  "status" text NOT NULL DEFAULT 'received',
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "sms_message_events_provider_event_idx" ON "sms_message_events" ("provider_event_id");
CREATE INDEX IF NOT EXISTS "sms_message_events_phone_created_idx" ON "sms_message_events" ("phone_e164", "created_at");
CREATE INDEX IF NOT EXISTS "sms_message_events_user_created_idx" ON "sms_message_events" ("user_id", "created_at");
