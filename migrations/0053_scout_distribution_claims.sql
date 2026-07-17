-- Durable idempotency claims for hourly scout distributions.
--
-- DEPLOYMENT CONTRACT (fail closed):
--   1. Pause every scheduled and manual scout_distribution runner.
--   2. Verify no scout_distribution execution is still running.
--   3. In the migration session run:
--        SET sportfolio.scout_distribution_scheduler_quiesced = 'on';
--   4. Apply this migration, deploy the canonical claim-first writer, then resume one runner.
--
-- The required session flag prevents an accidental unattended backfill. The ACCESS
-- EXCLUSIVE ledger lock waits for an in-flight legacy writer and prevents another legacy
-- insert from racing the historical snapshot while this atomic DO statement runs.
-- The ledger itself intentionally remains non-unique because it contains historical duplicates.
DO $migration$
BEGIN
  IF current_setting('sportfolio.scout_distribution_scheduler_quiesced', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      'Pause every scheduled/manual scout_distribution runner, verify quiescence, then SET sportfolio.scout_distribution_scheduler_quiesced = on in this migration session';
  END IF;

  LOCK TABLE "scout_distributions" IN ACCESS EXCLUSIVE MODE;

  CREATE TABLE "scout_distribution_claims" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "hour_timestamp" timestamp NOT NULL,
    "player_id" varchar NOT NULL REFERENCES "players"("id"),
    "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" timestamp NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX "scout_distribution_claims_event_idx"
    ON "scout_distribution_claims" ("hour_timestamp", "player_id", "user_id");

  -- Follow each directed alias chain to its terminal canonical player. Alias and
  -- canonical ledger rows for one user/hour then collapse into one claim key.
  WITH RECURSIVE "alias_paths" AS (
    SELECT
      pia."alias_player_id",
      pia."canonical_player_id",
      ARRAY[pia."alias_player_id", pia."canonical_player_id"]::varchar[] AS "path"
    FROM "player_id_aliases" pia

    UNION ALL

    SELECT
      ap."alias_player_id",
      next_alias."canonical_player_id",
      ap."path" || next_alias."canonical_player_id"
    FROM "alias_paths" ap
    JOIN "player_id_aliases" next_alias
      ON next_alias."alias_player_id" = ap."canonical_player_id"
    WHERE NOT next_alias."canonical_player_id" = ANY(ap."path")
  ),
  "canonical_aliases" AS (
    SELECT ap."alias_player_id", ap."canonical_player_id"
    FROM "alias_paths" ap
    WHERE NOT EXISTS (
      SELECT 1
      FROM "player_id_aliases" next_alias
      WHERE next_alias."alias_player_id" = ap."canonical_player_id"
    )
  )
  INSERT INTO "scout_distribution_claims" (
    "hour_timestamp",
    "player_id",
    "user_id",
    "created_at"
  )
  SELECT
    sd."hour_timestamp",
    COALESCE(ca."canonical_player_id", sd."player_id"),
    sd."user_id",
    MIN(sd."created_at")
  FROM "scout_distributions" sd
  LEFT JOIN "canonical_aliases" ca ON ca."alias_player_id" = sd."player_id"
  GROUP BY
    sd."hour_timestamp",
    COALESCE(ca."canonical_player_id", sd."player_id"),
    sd."user_id"
  ON CONFLICT ("hour_timestamp", "player_id", "user_id") DO NOTHING;
END
$migration$;
