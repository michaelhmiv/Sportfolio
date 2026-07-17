-- Drop collection XP points column + check (full XP purge, #272)
-- Idempotent for prod, no data loss beyond XP (kept fantasy points elsewhere).
ALTER TABLE collection_definition_versions
  DROP CONSTRAINT IF EXISTS collection_versions_points_check;

ALTER TABLE collection_definition_versions
  DROP COLUMN IF EXISTS points;
