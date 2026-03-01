CREATE TABLE IF NOT EXISTS "user_agent_message_embeddings" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id" varchar NOT NULL REFERENCES "user_agent_messages"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "thread_id" varchar NOT NULL REFERENCES "user_agent_threads"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'user',
  "message_type" text NOT NULL DEFAULT 'chat',
  "normalized_text" text NOT NULL,
  "semantic_route_hint" text,
  "embedding_provider" text NOT NULL DEFAULT 'local_hash',
  "embedding_model" text NOT NULL DEFAULT 'sportfolio-hash-384',
  "embedding_version" text NOT NULL DEFAULT '2026-03-01',
  "embedding" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_agent_message_embeddings_message_idx"
  ON "user_agent_message_embeddings" ("message_id");

CREATE INDEX IF NOT EXISTS "user_agent_message_embeddings_user_created_idx"
  ON "user_agent_message_embeddings" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "user_agent_message_embeddings_thread_created_idx"
  ON "user_agent_message_embeddings" ("thread_id", "created_at");

CREATE INDEX IF NOT EXISTS "user_agent_message_embeddings_route_created_idx"
  ON "user_agent_message_embeddings" ("semantic_route_hint", "created_at");
