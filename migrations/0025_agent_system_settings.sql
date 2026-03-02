CREATE TABLE IF NOT EXISTS "agent_system_settings" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "managed_provider" text NOT NULL DEFAULT 'chutes',
  "managed_model" text,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
