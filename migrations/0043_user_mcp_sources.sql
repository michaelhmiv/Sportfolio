CREATE TABLE IF NOT EXISTS "user_mcp_sources" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "auth_type" text NOT NULL DEFAULT 'none',
  "auth_token" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "discovered_tools" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "last_verified_at" timestamp,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "user_mcp_sources"
  ADD COLUMN IF NOT EXISTS "auth_type" text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "auth_token" text,
  ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "discovered_tools" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "last_verified_at" timestamp,
  ADD COLUMN IF NOT EXISTS "last_error" text,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();

UPDATE "user_mcp_sources"
SET
  "auth_type" = COALESCE("auth_type", 'none'),
  "enabled" = COALESCE("enabled", true),
  "discovered_tools" = COALESCE("discovered_tools", '[]'::jsonb),
  "updated_at" = COALESCE("updated_at", now())
WHERE
  "auth_type" IS NULL
  OR "enabled" IS NULL
  OR "discovered_tools" IS NULL
  OR "updated_at" IS NULL;

ALTER TABLE "user_mcp_sources"
  ALTER COLUMN "auth_type" SET DEFAULT 'none',
  ALTER COLUMN "auth_type" SET NOT NULL,
  ALTER COLUMN "enabled" SET DEFAULT true,
  ALTER COLUMN "enabled" SET NOT NULL,
  ALTER COLUMN "discovered_tools" SET DEFAULT '[]'::jsonb,
  ALTER COLUMN "discovered_tools" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT now(),
  ALTER COLUMN "updated_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "user_mcp_sources_user_idx"
  ON "user_mcp_sources" ("user_id");

CREATE INDEX IF NOT EXISTS "user_mcp_sources_user_enabled_idx"
  ON "user_mcp_sources" ("user_id", "enabled");
