-- Add profile visibility to users and align trophy-case FK cascades.
--
-- profileVisibility: 'public' (default) or 'private'.
-- Badge/featured preferences cascade on collection definition deletion
-- so cleanup is automatic when catalog entries are removed.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_visibility varchar(10) NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS auth_provider_subject varchar,
  ADD COLUMN IF NOT EXISTS auth_provider_subjects text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS auth_email_identity_hash varchar(64);

UPDATE users
SET auth_provider_subjects = ARRAY(
  SELECT DISTINCT subject
  FROM unnest(ARRAY[users.id, users.auth_provider_subject]) AS subject
  WHERE subject IS NOT NULL
)
WHERE cardinality(auth_provider_subjects) = 0;

-- Existing user ids historically came directly from Supabase. Preserve that mapping
-- as a deletion tombstone; future provider-id changes update this column without
-- rewriting the canonical user primary key.
UPDATE users
SET auth_provider_subject = id
WHERE auth_provider_subject IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_provider_subject_idx
  ON users (auth_provider_subject)
  WHERE auth_provider_subject IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_email_identity_hash_idx
  ON users (auth_email_identity_hash)
  WHERE auth_email_identity_hash IS NOT NULL;

-- ADD CONSTRAINT IF NOT EXISTS is not supported in standard SQL; use
-- a DO block to avoid errors on repeat runs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_profile_visibility_check'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_profile_visibility_check
        CHECK (profile_visibility IN ('public', 'private'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_profile_visibility_idx
  ON users (profile_visibility);

-- Replace RESTRICT FK with CASCADE on collection definition deletion
-- for badge preferences and featured collections.

ALTER TABLE user_badge_preferences
  DROP CONSTRAINT IF EXISTS user_badge_preferences_collection_definition_id_fkey;

ALTER TABLE user_badge_preferences
  ADD CONSTRAINT user_badge_preferences_collection_definition_id_fkey
    FOREIGN KEY (collection_definition_id)
    REFERENCES collection_definitions(id)
    ON DELETE CASCADE;

ALTER TABLE user_featured_collections
  DROP CONSTRAINT IF EXISTS user_featured_collections_collection_definition_id_fkey;

ALTER TABLE user_featured_collections
  ADD CONSTRAINT user_featured_collections_collection_definition_id_fkey
    FOREIGN KEY (collection_definition_id)
    REFERENCES collection_definitions(id)
    ON DELETE CASCADE;

-- Make product limits durable even for out-of-band writes. Remove only
-- impossible legacy overflow rows before tightening the existing checks.
DELETE FROM user_badge_preferences WHERE priority < 0 OR priority > 4;
ALTER TABLE user_badge_preferences
  DROP CONSTRAINT IF EXISTS user_badge_preferences_priority_check;
ALTER TABLE user_badge_preferences
  ADD CONSTRAINT user_badge_preferences_priority_check
    CHECK (priority BETWEEN 0 AND 4);

DELETE FROM user_featured_collections WHERE position < 0 OR position > 3;
ALTER TABLE user_featured_collections
  DROP CONSTRAINT IF EXISTS user_featured_collections_position_check;
ALTER TABLE user_featured_collections
  ADD CONSTRAINT user_featured_collections_position_check
    CHECK (position BETWEEN 0 AND 3);
