-- Collections v2 foundation.
--
-- This migration is deliberately additive. The legacy user_collections rows were derived
-- from flawed possession scans and are not authoritative evidence of factual completion.
-- No legacy row is copied into user_collection_awards.

ALTER TABLE holdings_locks
  ALTER COLUMN locked_quantity TYPE numeric(20,4)
  USING locked_quantity::numeric(20,4);

CREATE UNIQUE INDEX locks_collection_reference_unique
  ON holdings_locks (lock_reference_id)
  WHERE lock_type = 'collection';

CREATE TABLE collection_definitions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(180) NOT NULL,
  sport varchar(20) NOT NULL,
  league varchar(40) NOT NULL,
  season varchar(20) NOT NULL,
  family varchar(60) NOT NULL,
  kind varchar(30) NOT NULL DEFAULT 'player_slots',
  lifecycle_status varchar(30) NOT NULL DEFAULT 'draft',
  current_version integer NOT NULL DEFAULT 1,
  published_at timestamptz,
  finalizing_at timestamptz,
  finalized_at timestamptz,
  disabled_at timestamptz,
  disabled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_definitions_slug_unique UNIQUE (slug),
  CONSTRAINT collection_definitions_kind_check
    CHECK (kind IN ('player_slots', 'master')),
  CONSTRAINT collection_definitions_lifecycle_check
    CHECK (lifecycle_status IN ('draft', 'tracking', 'finalizing', 'final', 'disabled')),
  CONSTRAINT collection_definitions_current_version_check CHECK (current_version > 0),
  CONSTRAINT collection_definitions_disable_check
    CHECK (
      (lifecycle_status = 'disabled' AND disabled_at IS NOT NULL)
      OR (lifecycle_status <> 'disabled' AND disabled_at IS NULL)
    )
);

CREATE TABLE collection_definition_versions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id varchar NOT NULL REFERENCES collection_definitions(id) ON DELETE CASCADE,
  version integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  qualification_description text NOT NULL,
  qualification_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_type varchar(60) NOT NULL,
  source_uri text,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  art_key text NOT NULL,
  state varchar(30) NOT NULL DEFAULT 'draft',
  correction_of_version_id varchar,
  published_at timestamptz,
  membership_locked_at timestamptz,
  finalized_at timestamptz,
  created_by varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_versions_definition_version_unique UNIQUE (definition_id, version),
  CONSTRAINT collection_versions_version_check CHECK (version > 0),
  CONSTRAINT collection_versions_state_check CHECK (state IN ('draft', 'tracking', 'final')),
  CONSTRAINT collection_versions_final_check
    CHECK ((state = 'final' AND finalized_at IS NOT NULL) OR state <> 'final')
);

ALTER TABLE collection_definition_versions
  ADD CONSTRAINT collection_versions_correction_fk
  FOREIGN KEY (correction_of_version_id)
  REFERENCES collection_definition_versions(id)
  ON DELETE RESTRICT;

CREATE TABLE collection_slots (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_version_id varchar NOT NULL
    REFERENCES collection_definition_versions(id) ON DELETE CASCADE,
  player_id varchar REFERENCES players(id) ON DELETE RESTRICT,
  slot_key varchar(120) NOT NULL,
  slot_label text NOT NULL,
  required_quantity numeric(20,4) NOT NULL,
  is_required boolean NOT NULL DEFAULT true,
  status varchar(24) NOT NULL DEFAULT 'active',
  rank integer,
  stat_key varchar(80),
  qualification_value numeric(20,6),
  qualification_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order integer NOT NULL,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_slots_version_key_unique UNIQUE (collection_version_id, slot_key),
  CONSTRAINT collection_slots_required_quantity_check CHECK (required_quantity > 0),
  CONSTRAINT collection_slots_status_check CHECK (status IN ('active', 'vacant', 'removed')),
  CONSTRAINT collection_slots_active_player_check
    CHECK (
      (status = 'active' AND player_id IS NOT NULL)
      OR (status = 'vacant' AND player_id IS NULL)
      OR status = 'removed'
    ),
  CONSTRAINT collection_slots_removed_check
    CHECK (
      (status = 'removed' AND removed_at IS NOT NULL)
      OR (status <> 'removed' AND removed_at IS NULL)
    ),
  CONSTRAINT collection_slots_display_order_check CHECK (display_order >= 0),
  CONSTRAINT collection_slots_rank_check CHECK (rank IS NULL OR rank > 0)
);

CREATE TABLE collection_prerequisites (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  master_version_id varchar NOT NULL
    REFERENCES collection_definition_versions(id) ON DELETE CASCADE,
  prerequisite_version_id varchar NOT NULL
    REFERENCES collection_definition_versions(id) ON DELETE RESTRICT,
  is_required boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_prerequisites_version_unique
    UNIQUE (master_version_id, prerequisite_version_id),
  CONSTRAINT collection_prerequisites_not_self_check
    CHECK (master_version_id <> prerequisite_version_id),
  CONSTRAINT collection_prerequisites_display_order_check CHECK (display_order >= 0)
);

CREATE TABLE user_collection_allocations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_slot_id varchar NOT NULL REFERENCES collection_slots(id) ON DELETE RESTRICT,
  player_id varchar NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  allocated_quantity numeric(20,4) NOT NULL,
  lock_reference_id varchar NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'active',
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_collection_allocations_user_slot_unique UNIQUE (user_id, collection_slot_id),
  CONSTRAINT user_collection_allocations_lock_reference_unique UNIQUE (lock_reference_id),
  CONSTRAINT user_collection_allocations_quantity_check CHECK (allocated_quantity > 0),
  CONSTRAINT user_collection_allocations_status_check CHECK (status IN ('active', 'released')),
  CONSTRAINT user_collection_allocations_release_check
    CHECK (
      (status = 'released' AND released_at IS NOT NULL)
      OR (status = 'active' AND released_at IS NULL)
    )
);

CREATE TABLE user_collection_states (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_definition_id varchar NOT NULL
    REFERENCES collection_definitions(id) ON DELETE RESTRICT,
  collection_version_id varchar NOT NULL
    REFERENCES collection_definition_versions(id) ON DELETE RESTRICT,
  assembly_state varchar(24) NOT NULL DEFAULT 'unstarted',
  allocated_quantity numeric(20,4) NOT NULL DEFAULT 0,
  required_quantity numeric(20,4) NOT NULL DEFAULT 0,
  qualified_slot_count integer NOT NULL DEFAULT 0,
  required_slot_count integer NOT NULL DEFAULT 0,
  progress_bps integer NOT NULL DEFAULT 0,
  ready_at timestamptz,
  activated_at timestamptz,
  deactivated_at timestamptz,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_collection_states_user_version_unique UNIQUE (user_id, collection_version_id),
  CONSTRAINT user_collection_states_assembly_check
    CHECK (assembly_state IN ('unstarted', 'in_progress', 'ready', 'active', 'inactive')),
  CONSTRAINT user_collection_states_quantity_check
    CHECK (allocated_quantity >= 0 AND required_quantity >= 0),
  CONSTRAINT user_collection_states_slots_check
    CHECK (
      qualified_slot_count >= 0
      AND required_slot_count >= 0
      AND qualified_slot_count <= required_slot_count
    ),
  CONSTRAINT user_collection_states_progress_check CHECK (progress_bps BETWEEN 0 AND 10000),
  CONSTRAINT user_collection_states_ready_check
    CHECK (assembly_state <> 'ready' OR ready_at IS NOT NULL),
  CONSTRAINT user_collection_states_active_check
    CHECK (assembly_state <> 'active' OR activated_at IS NOT NULL)
);

CREATE TABLE user_collection_awards (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_definition_id varchar NOT NULL
    REFERENCES collection_definitions(id) ON DELETE RESTRICT,
  collection_version_id varchar NOT NULL
    REFERENCES collection_definition_versions(id) ON DELETE RESTRICT,
  first_completed_at timestamptz NOT NULL,
  completion_sequence integer,
  rarity_snapshot jsonb,
  reward_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_collection_awards_user_version_unique UNIQUE (user_id, collection_version_id),
  CONSTRAINT user_collection_awards_sequence_check
    CHECK (completion_sequence IS NULL OR completion_sequence > 0),
  CONSTRAINT user_collection_awards_reward_metadata_size_check
    CHECK (reward_metadata IS NULL OR octet_length(reward_metadata::text) <= 16384)
);

CREATE TABLE user_collection_state_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_definition_id varchar NOT NULL
    REFERENCES collection_definitions(id) ON DELETE RESTRICT,
  collection_version_id varchar NOT NULL
    REFERENCES collection_definition_versions(id) ON DELETE RESTRICT,
  event_type varchar(40) NOT NULL,
  previous_state varchar(24),
  next_state varchar(24) NOT NULL,
  reason varchar(80) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_collection_state_events_type_check
    CHECK (
      event_type IN (
        'progress_changed',
        'ready',
        'completed',
        'deactivated',
        'reactivated',
        'membership_changed'
      )
    ),
  CONSTRAINT user_collection_state_events_previous_check
    CHECK (
      previous_state IS NULL
      OR previous_state IN ('unstarted', 'in_progress', 'ready', 'active', 'inactive')
    ),
  CONSTRAINT user_collection_state_events_next_check
    CHECK (next_state IN ('unstarted', 'in_progress', 'ready', 'active', 'inactive'))
);

CREATE TABLE user_badge_preferences (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_definition_id varchar NOT NULL
    REFERENCES collection_definitions(id) ON DELETE RESTRICT,
  priority integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_badge_preferences_definition_unique
    UNIQUE (user_id, collection_definition_id),
  CONSTRAINT user_badge_preferences_priority_unique UNIQUE (user_id, priority),
  CONSTRAINT user_badge_preferences_priority_check CHECK (priority >= 0)
);

CREATE TABLE user_featured_collections (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_definition_id varchar NOT NULL
    REFERENCES collection_definitions(id) ON DELETE RESTRICT,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_featured_collections_definition_unique
    UNIQUE (user_id, collection_definition_id),
  CONSTRAINT user_featured_collections_position_unique UNIQUE (user_id, position),
  CONSTRAINT user_featured_collections_position_check CHECK (position >= 0)
);

CREATE INDEX collection_definitions_catalog_idx
  ON collection_definitions (sport, season, family, lifecycle_status);
CREATE INDEX collection_definitions_lifecycle_idx
  ON collection_definitions (lifecycle_status);
CREATE INDEX collection_versions_state_idx
  ON collection_definition_versions (state, finalized_at);
CREATE INDEX collection_slots_version_order_idx
  ON collection_slots (collection_version_id, display_order);
CREATE INDEX collection_slots_player_idx
  ON collection_slots (player_id, status);
CREATE INDEX collection_prerequisites_lookup_idx
  ON collection_prerequisites (prerequisite_version_id);
CREATE INDEX user_collection_allocations_user_status_idx
  ON user_collection_allocations (user_id, status);
CREATE INDEX user_collection_allocations_player_status_idx
  ON user_collection_allocations (player_id, status);
CREATE INDEX user_collection_states_user_state_idx
  ON user_collection_states (user_id, assembly_state);
CREATE INDEX user_collection_states_active_definition_idx
  ON user_collection_states (collection_definition_id, assembly_state);
CREATE INDEX user_collection_awards_trophy_case_idx
  ON user_collection_awards (user_id, first_completed_at DESC);
CREATE INDEX user_collection_awards_definition_idx
  ON user_collection_awards (collection_definition_id, first_completed_at);
CREATE INDEX user_collection_state_events_user_occurred_idx
  ON user_collection_state_events (user_id, occurred_at DESC);
CREATE INDEX user_collection_state_events_definition_occurred_idx
  ON user_collection_state_events (collection_definition_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_published_collection_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_published_version boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM collection_definition_versions
    WHERE definition_id = OLD.id
      AND state <> 'draft'
  )
  INTO has_published_version;

  IF OLD.kind IS DISTINCT FROM NEW.kind THEN
    IF NEW.kind = 'master'
       AND EXISTS (
         SELECT 1
         FROM collection_slots slot
         JOIN collection_definition_versions version
           ON version.id = slot.collection_version_id
         WHERE version.definition_id = OLD.id
       ) THEN
      RAISE EXCEPTION 'master collections cannot contain player slots'
        USING ERRCODE = '23514';
    ELSIF NEW.kind = 'player_slots'
       AND EXISTS (
         SELECT 1
         FROM collection_prerequisites prerequisite
         JOIN collection_definition_versions version
           ON version.id = prerequisite.master_version_id
         WHERE version.definition_id = OLD.id
       ) THEN
      RAISE EXCEPTION 'only master collections can declare prerequisites'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF (OLD.lifecycle_status <> 'draft' OR has_published_version)
     AND (
       OLD.slug IS DISTINCT FROM NEW.slug
       OR OLD.sport IS DISTINCT FROM NEW.sport
       OR OLD.league IS DISTINCT FROM NEW.league
       OR OLD.season IS DISTINCT FROM NEW.season
       OR OLD.family IS DISTINCT FROM NEW.family
       OR OLD.kind IS DISTINCT FROM NEW.kind
     ) THEN
    RAISE EXCEPTION 'collection identity is immutable after publication; create a new definition'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_definitions_identity_immutable
BEFORE UPDATE OF slug, sport, league, season, family, kind
ON collection_definitions
FOR EACH ROW
EXECUTE FUNCTION prevent_published_collection_identity_mutation();

CREATE OR REPLACE FUNCTION prevent_published_collection_definition_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.lifecycle_status <> 'draft'
     OR EXISTS (
       SELECT 1
       FROM collection_definition_versions
       WHERE definition_id = OLD.id
         AND state <> 'draft'
     ) THEN
    RAISE EXCEPTION 'published collections cannot be deleted; disable them instead'
      USING ERRCODE = '55000';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER collection_definitions_published_delete_protected
BEFORE DELETE ON collection_definitions
FOR EACH ROW
EXECUTE FUNCTION prevent_published_collection_definition_delete();

CREATE OR REPLACE FUNCTION serialize_collection_version_definition_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_definition_id varchar;
  new_definition_id varchar;
BEGIN
  old_definition_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.definition_id END;
  new_definition_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.definition_id END;

  -- Serialize version creation/removal with current-version pointer and definition mutations.
  PERFORM 1
  FROM collection_definitions
  WHERE id = old_definition_id OR id = new_definition_id
  ORDER BY id
  FOR UPDATE;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_versions_definition_serialized
BEFORE INSERT OR UPDATE OR DELETE ON collection_definition_versions
FOR EACH ROW
EXECUTE FUNCTION serialize_collection_version_definition_mutation();

CREATE OR REPLACE FUNCTION prevent_collection_unpublication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'collection_definitions' THEN
    IF OLD.lifecycle_status <> 'draft' AND NEW.lifecycle_status = 'draft' THEN
      RAISE EXCEPTION 'published collection definitions cannot return to draft'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND OLD.state <> 'draft' AND NEW.state = 'draft' THEN
      RAISE EXCEPTION 'published collection versions cannot return to draft'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.state <> 'draft' THEN
      -- Serialize publication with identity mutation, kind mutation, and definition deletion.
      PERFORM 1
      FROM collection_definitions
      WHERE id = NEW.definition_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'collection version definition does not exist'
          USING ERRCODE = '23503';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_definitions_publication_irreversible
BEFORE UPDATE OF lifecycle_status ON collection_definitions
FOR EACH ROW
EXECUTE FUNCTION prevent_collection_unpublication();

CREATE TRIGGER collection_versions_publication_irreversible
BEFORE INSERT OR UPDATE OF state ON collection_definition_versions
FOR EACH ROW
EXECUTE FUNCTION prevent_collection_unpublication();

CREATE OR REPLACE FUNCTION validate_collection_publication_consistency(definition_id_to_check varchar)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  definition_lifecycle varchar;
BEGIN
  SELECT lifecycle_status
  INTO definition_lifecycle
  FROM collection_definitions
  WHERE id = definition_id_to_check;

  IF definition_lifecycle IS NULL THEN
    RETURN;
  END IF;

  IF definition_lifecycle = 'draft'
     AND EXISTS (
       SELECT 1
       FROM collection_definition_versions
       WHERE definition_id = definition_id_to_check
         AND state <> 'draft'
     ) THEN
    RAISE EXCEPTION 'a draft collection definition cannot contain a published version'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_collection_current_version_pointer(definition_id_to_check varchar)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  pointed_version integer;
BEGIN
  SELECT current_version
  INTO pointed_version
  FROM collection_definitions
  WHERE id = definition_id_to_check;

  -- The definition may have been deleted with its versions in the same transaction.
  IF pointed_version IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM collection_definition_versions
    WHERE definition_id = definition_id_to_check
      AND version = pointed_version
  ) THEN
    RAISE EXCEPTION 'collection current_version must reference an existing version of the same definition'
      USING ERRCODE = '23503';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_collection_current_version_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_definition_id varchar;
  new_definition_id varchar;
BEGIN
  IF TG_TABLE_NAME = 'collection_definitions' THEN
    old_definition_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.id END;
    new_definition_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.id END;
  ELSE
    old_definition_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.definition_id END;
    new_definition_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.definition_id END;
  END IF;

  IF old_definition_id IS NOT NULL THEN
    PERFORM validate_collection_current_version_pointer(old_definition_id);
    PERFORM validate_collection_publication_consistency(old_definition_id);
  END IF;
  IF new_definition_id IS NOT NULL AND new_definition_id IS DISTINCT FROM old_definition_id THEN
    PERFORM validate_collection_current_version_pointer(new_definition_id);
    PERFORM validate_collection_publication_consistency(new_definition_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER collection_definitions_current_version_valid
AFTER INSERT OR UPDATE OR DELETE ON collection_definitions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_collection_current_version_change();

CREATE CONSTRAINT TRIGGER collection_versions_current_pointer_valid
AFTER INSERT OR UPDATE OR DELETE ON collection_definition_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_collection_current_version_change();

CREATE OR REPLACE FUNCTION prevent_collection_version_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.definition_id IS DISTINCT FROM NEW.definition_id THEN
    RAISE EXCEPTION 'collection version definition_id is immutable; create a version on the target definition'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_versions_definition_immutable
BEFORE UPDATE OF definition_id ON collection_definition_versions
FOR EACH ROW
EXECUTE FUNCTION prevent_collection_version_reparenting();

CREATE OR REPLACE FUNCTION validate_collection_correction_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_definition_id varchar;
  target_version integer;
  target_state varchar;
BEGIN
  IF NEW.correction_of_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT definition_id, version, state
  INTO target_definition_id, target_version, target_state
  FROM collection_definition_versions
  WHERE id = NEW.correction_of_version_id;

  IF target_definition_id IS NULL
     OR target_definition_id <> NEW.definition_id
     OR target_version >= NEW.version
     OR target_state <> 'final' THEN
    RAISE EXCEPTION 'correction target must be an earlier final version of the same collection definition'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_versions_correction_valid
BEFORE INSERT OR UPDATE OF definition_id, version, correction_of_version_id
ON collection_definition_versions
FOR EACH ROW
EXECUTE FUNCTION validate_collection_correction_reference();

CREATE OR REPLACE FUNCTION validate_collection_membership_kind()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  membership_kind varchar;
BEGIN
  IF TG_TABLE_NAME = 'collection_slots' THEN
    SELECT definition.kind
    INTO membership_kind
    FROM collection_definition_versions version
    JOIN collection_definitions definition ON definition.id = version.definition_id
    WHERE version.id = NEW.collection_version_id
    FOR UPDATE OF definition;

    IF membership_kind = 'master' THEN
      RAISE EXCEPTION 'master collections cannot contain player slots'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT definition.kind
    INTO membership_kind
    FROM collection_definition_versions version
    JOIN collection_definitions definition ON definition.id = version.definition_id
    WHERE version.id = NEW.master_version_id
    FOR UPDATE OF definition;

    IF membership_kind = 'player_slots' THEN
      RAISE EXCEPTION 'only master collections can declare prerequisites'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_slots_kind_valid
BEFORE INSERT OR UPDATE OF collection_version_id
ON collection_slots
FOR EACH ROW
EXECUTE FUNCTION validate_collection_membership_kind();

CREATE TRIGGER collection_prerequisites_kind_valid
BEFORE INSERT OR UPDATE OF master_version_id
ON collection_prerequisites
FOR EACH ROW
EXECUTE FUNCTION validate_collection_membership_kind();

CREATE OR REPLACE FUNCTION validate_collection_definition_membership(definition_id_to_check varchar)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  definition_kind varchar;
BEGIN
  SELECT kind
  INTO definition_kind
  FROM collection_definitions
  WHERE id = definition_id_to_check;

  IF definition_kind IS NULL THEN
    RETURN;
  END IF;

  IF definition_kind = 'master'
     AND EXISTS (
       SELECT 1
       FROM collection_slots slot
       JOIN collection_definition_versions version
         ON version.id = slot.collection_version_id
       WHERE version.definition_id = definition_id_to_check
     ) THEN
    RAISE EXCEPTION 'master collections cannot contain player slots'
      USING ERRCODE = '23514';
  END IF;

  IF definition_kind = 'player_slots'
     AND EXISTS (
       SELECT 1
       FROM collection_prerequisites prerequisite
       JOIN collection_definition_versions version
         ON version.id = prerequisite.master_version_id
       WHERE version.definition_id = definition_id_to_check
     ) THEN
    RAISE EXCEPTION 'only master collections can declare prerequisites'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_collection_membership_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_definition_id varchar;
  new_definition_id varchar;
BEGIN
  IF TG_TABLE_NAME = 'collection_definitions' THEN
    old_definition_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.id END;
    new_definition_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.id END;
  ELSIF TG_TABLE_NAME = 'collection_slots' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT definition_id INTO old_definition_id
      FROM collection_definition_versions
      WHERE id = OLD.collection_version_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT definition_id INTO new_definition_id
      FROM collection_definition_versions
      WHERE id = NEW.collection_version_id;
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      SELECT definition_id INTO old_definition_id
      FROM collection_definition_versions
      WHERE id = OLD.master_version_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT definition_id INTO new_definition_id
      FROM collection_definition_versions
      WHERE id = NEW.master_version_id;
    END IF;
  END IF;

  IF old_definition_id IS NOT NULL THEN
    PERFORM validate_collection_definition_membership(old_definition_id);
  END IF;
  IF new_definition_id IS NOT NULL AND new_definition_id IS DISTINCT FROM old_definition_id THEN
    PERFORM validate_collection_definition_membership(new_definition_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER collection_definitions_membership_valid
AFTER INSERT OR UPDATE OR DELETE ON collection_definitions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_collection_membership_change();

CREATE CONSTRAINT TRIGGER collection_slots_definition_kind_valid
AFTER INSERT OR UPDATE OR DELETE ON collection_slots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_collection_membership_change();

CREATE CONSTRAINT TRIGGER collection_prerequisites_definition_kind_valid
AFTER INSERT OR UPDATE OR DELETE ON collection_prerequisites
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_collection_membership_change();

CREATE OR REPLACE FUNCTION validate_collection_allocation_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  slot_player_id varchar;
  slot_status varchar;
  slot_required_quantity numeric(20,4);
BEGIN
  SELECT player_id, status, required_quantity
  INTO slot_player_id, slot_status, slot_required_quantity
  FROM collection_slots
  WHERE id = NEW.collection_slot_id
  FOR UPDATE;

  IF slot_player_id IS NULL OR slot_status <> 'active' OR slot_player_id <> NEW.player_id THEN
    RAISE EXCEPTION 'collection allocation player does not match an active slot'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.allocated_quantity > slot_required_quantity THEN
    RAISE EXCEPTION 'collection allocation quantity exceeds slot requirement'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER user_collection_allocations_reference_valid
BEFORE INSERT OR UPDATE OF collection_slot_id, player_id, allocated_quantity, status
ON user_collection_allocations
FOR EACH ROW
WHEN (NEW.status = 'active')
EXECUTE FUNCTION validate_collection_allocation_reference();

CREATE OR REPLACE FUNCTION prevent_slot_change_with_active_allocations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
       OLD.collection_version_id IS DISTINCT FROM NEW.collection_version_id
       OR OLD.player_id IS DISTINCT FROM NEW.player_id
       OR OLD.required_quantity IS DISTINCT FROM NEW.required_quantity
       OR OLD.status IS DISTINCT FROM NEW.status
     )
     AND EXISTS (
       SELECT 1
       FROM user_collection_allocations
       WHERE collection_slot_id = OLD.id
         AND status = 'active'
     ) THEN
    RAISE EXCEPTION 'release active allocations before changing collection slot membership'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_slots_active_allocations_protected
BEFORE UPDATE OF collection_version_id, player_id, required_quantity, status
ON collection_slots
FOR EACH ROW
EXECUTE FUNCTION prevent_slot_change_with_active_allocations();

CREATE OR REPLACE FUNCTION validate_collection_slot_allocations(slot_id_to_check varchar)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM user_collection_allocations allocation
    LEFT JOIN collection_slots slot ON slot.id = allocation.collection_slot_id
    WHERE allocation.collection_slot_id = slot_id_to_check
      AND allocation.status = 'active'
      AND (
        slot.id IS NULL
        OR slot.status <> 'active'
        OR slot.player_id IS DISTINCT FROM allocation.player_id
        OR allocation.allocated_quantity > slot.required_quantity
      )
  ) THEN
    RAISE EXCEPTION 'active collection allocations must match an active slot and its requirement'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_collection_slot_allocation_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_slot_id varchar;
  new_slot_id varchar;
BEGIN
  IF TG_TABLE_NAME = 'collection_slots' THEN
    old_slot_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.id END;
    new_slot_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.id END;
  ELSE
    old_slot_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.collection_slot_id END;
    new_slot_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.collection_slot_id END;
  END IF;

  IF old_slot_id IS NOT NULL THEN
    PERFORM validate_collection_slot_allocations(old_slot_id);
  END IF;
  IF new_slot_id IS NOT NULL AND new_slot_id IS DISTINCT FROM old_slot_id THEN
    PERFORM validate_collection_slot_allocations(new_slot_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER collection_slots_allocations_valid
AFTER INSERT OR UPDATE OR DELETE ON collection_slots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_collection_slot_allocation_change();

CREATE CONSTRAINT TRIGGER user_collection_allocations_slot_valid
AFTER INSERT OR UPDATE OR DELETE ON user_collection_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_collection_slot_allocation_change();

CREATE OR REPLACE FUNCTION prevent_collection_pair_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'user_collection_allocations'
     AND OLD.lock_reference_id IS DISTINCT FROM NEW.lock_reference_id THEN
    RAISE EXCEPTION 'collection allocation lock reference is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_TABLE_NAME = 'holdings_locks'
     AND (OLD.lock_type = 'collection' OR NEW.lock_type = 'collection')
     AND OLD.lock_reference_id IS DISTINCT FROM NEW.lock_reference_id THEN
    RAISE EXCEPTION 'collection holdings lock reference is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER user_collection_allocations_lock_reference_immutable
BEFORE UPDATE OF lock_reference_id ON user_collection_allocations
FOR EACH ROW
EXECUTE FUNCTION prevent_collection_pair_identity_mutation();

CREATE TRIGGER holdings_locks_collection_reference_immutable
BEFORE UPDATE OF lock_reference_id, lock_type ON holdings_locks
FOR EACH ROW
EXECUTE FUNCTION prevent_collection_pair_identity_mutation();

CREATE OR REPLACE FUNCTION validate_collection_lock_allocation_pair(reference_id varchar)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  allocation_id varchar;
  allocation_user_id varchar;
  allocation_player_id varchar;
  allocation_quantity numeric(20,4);
  allocation_status varchar;
  lock_id varchar;
  lock_user_id varchar;
  lock_asset_type text;
  lock_asset_id text;
  lock_quantity numeric(20,4);
BEGIN
  SELECT id, user_id, player_id, allocated_quantity, status
  INTO allocation_id, allocation_user_id, allocation_player_id, allocation_quantity,
       allocation_status
  FROM user_collection_allocations
  WHERE lock_reference_id = reference_id;

  SELECT id, user_id, asset_type, asset_id, locked_quantity
  INTO lock_id, lock_user_id, lock_asset_type, lock_asset_id, lock_quantity
  FROM holdings_locks
  WHERE lock_type = 'collection'
    AND lock_reference_id = reference_id;

  IF allocation_status = 'active' THEN
    IF lock_id IS NULL
       OR lock_user_id <> allocation_user_id
       OR lock_asset_type <> 'player'
       OR lock_asset_id <> allocation_player_id
       OR lock_quantity <> allocation_quantity THEN
      RAISE EXCEPTION 'active collection allocation must match one exact collection holdings lock'
        USING ERRCODE = '23514';
    END IF;
  ELSIF lock_id IS NOT NULL THEN
    RAISE EXCEPTION 'collection holdings lock must reference an active collection allocation'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_collection_lock_allocation_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reference_id varchar;
BEGIN
  IF TG_TABLE_NAME = 'user_collection_allocations' THEN
    reference_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.lock_reference_id ELSE NEW.lock_reference_id END;
  ELSE
    IF TG_OP = 'DELETE' THEN
      IF OLD.lock_type <> 'collection' THEN
        RETURN NULL;
      END IF;
      reference_id := OLD.lock_reference_id;
    ELSE
      IF NEW.lock_type <> 'collection' AND OLD.lock_type <> 'collection' THEN
        RETURN NULL;
      END IF;
      reference_id := NEW.lock_reference_id;
    END IF;
  END IF;

  PERFORM validate_collection_lock_allocation_pair(reference_id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER user_collection_allocations_lock_pair_valid
AFTER INSERT OR UPDATE OR DELETE ON user_collection_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_collection_lock_allocation_change();

CREATE CONSTRAINT TRIGGER holdings_locks_collection_allocation_valid
AFTER INSERT OR UPDATE OR DELETE ON holdings_locks
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_collection_lock_allocation_change();

CREATE OR REPLACE FUNCTION validate_collection_version_definition_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_definition_id varchar;
BEGIN
  SELECT definition_id
  INTO version_definition_id
  FROM collection_definition_versions
  WHERE id = NEW.collection_version_id;

  IF version_definition_id IS NULL OR version_definition_id <> NEW.collection_definition_id THEN
    RAISE EXCEPTION 'collection version does not belong to collection definition'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER user_collection_states_definition_valid
BEFORE INSERT OR UPDATE OF collection_definition_id, collection_version_id
ON user_collection_states
FOR EACH ROW
EXECUTE FUNCTION validate_collection_version_definition_reference();

CREATE TRIGGER user_collection_awards_definition_valid
BEFORE INSERT OR UPDATE OF collection_definition_id, collection_version_id
ON user_collection_awards
FOR EACH ROW
EXECUTE FUNCTION validate_collection_version_definition_reference();

CREATE TRIGGER user_collection_state_events_definition_valid
BEFORE INSERT OR UPDATE OF collection_definition_id, collection_version_id
ON user_collection_state_events
FOR EACH ROW
EXECUTE FUNCTION validate_collection_version_definition_reference();

CREATE OR REPLACE FUNCTION prevent_collection_award_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Awards are user-owned personal data. Preserve normal immutability while allowing
  -- the users ON DELETE CASCADE path required by account deletion and privacy erasure.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'collection awards are immutable; create a corrective record instead'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER user_collection_awards_immutable
BEFORE UPDATE OR DELETE ON user_collection_awards
FOR EACH ROW
EXECUTE FUNCTION prevent_collection_award_mutation();

CREATE OR REPLACE FUNCTION prevent_collection_state_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- State events are user-owned audit data. Preserve append-only history while allowing
  -- the users ON DELETE CASCADE path required by account deletion and privacy erasure.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'collection state events are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER user_collection_state_events_immutable
BEFORE UPDATE OR DELETE ON user_collection_state_events
FOR EACH ROW
EXECUTE FUNCTION prevent_collection_state_event_mutation();

CREATE OR REPLACE FUNCTION prevent_final_collection_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  protected_old_version_id varchar;
  protected_new_version_id varchar;
  protected_version_state varchar;
BEGIN
  IF TG_TABLE_NAME = 'collection_definition_versions' THEN
    IF OLD.state = 'final' THEN
      RAISE EXCEPTION 'final collection definition versions are immutable; create a correction version'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'collection_slots' THEN
    IF TG_OP = 'UPDATE' THEN
      protected_old_version_id := OLD.collection_version_id;
      protected_new_version_id := NEW.collection_version_id;
    ELSIF TG_OP = 'DELETE' THEN
      protected_old_version_id := OLD.collection_version_id;
    ELSE
      protected_new_version_id := NEW.collection_version_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'collection_prerequisites' THEN
    IF TG_OP = 'UPDATE' THEN
      protected_old_version_id := OLD.master_version_id;
      protected_new_version_id := NEW.master_version_id;
    ELSIF TG_OP = 'DELETE' THEN
      protected_old_version_id := OLD.master_version_id;
    ELSE
      protected_new_version_id := NEW.master_version_id;
    END IF;
  END IF;

  IF TG_TABLE_NAME <> 'collection_definition_versions' THEN
    -- Serialize membership writes with the parent-version update that finalizes membership.
    -- Lock in deterministic id order so opposite-direction moves cannot deadlock.
    PERFORM 1
    FROM collection_definition_versions
    WHERE id = protected_old_version_id OR id = protected_new_version_id
    ORDER BY id
    FOR UPDATE;
  END IF;

  IF protected_old_version_id IS NOT NULL THEN
    SELECT state
    INTO protected_version_state
    FROM collection_definition_versions
    WHERE id = protected_old_version_id;

    IF protected_version_state = 'final' THEN
      RAISE EXCEPTION 'final collection membership is immutable; create a correction version'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF protected_new_version_id IS NOT NULL
     AND protected_new_version_id IS DISTINCT FROM protected_old_version_id THEN
    SELECT state
    INTO protected_version_state
    FROM collection_definition_versions
    WHERE id = protected_new_version_id;

    IF protected_version_state = 'final' THEN
      RAISE EXCEPTION 'final collection membership is immutable; create a correction version'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_versions_final_immutable
BEFORE UPDATE OR DELETE ON collection_definition_versions
FOR EACH ROW
EXECUTE FUNCTION prevent_final_collection_version_mutation();

CREATE TRIGGER collection_slots_final_immutable
BEFORE INSERT OR UPDATE OR DELETE ON collection_slots
FOR EACH ROW
EXECUTE FUNCTION prevent_final_collection_version_mutation();

CREATE TRIGGER collection_prerequisites_final_immutable
BEFORE INSERT OR UPDATE OR DELETE ON collection_prerequisites
FOR EACH ROW
EXECUTE FUNCTION prevent_final_collection_version_mutation();

COMMENT ON TABLE user_collections IS
  'LEGACY: possession-scan scaffolding. Do not grant factual collection awards from this table.';
COMMENT ON TABLE collection_definition_versions IS
  'Versioned collection content. Rows and membership are immutable after state becomes final.';
COMMENT ON TABLE user_collection_awards IS
  'Immutable first-completion history created only by deliberate completion.';
COMMENT ON TABLE user_collection_state_events IS
  'Append-only collection state audit history; deletions occur only through account erasure.';
COMMENT ON COLUMN holdings_locks.locked_quantity IS
  'Exact reserved quantity, including collection allocations; numeric to match decimal holdings.';

ALTER TABLE collection_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_definition_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_prerequisites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_collection_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_collection_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_collection_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_collection_state_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badge_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_featured_collections ENABLE ROW LEVEL SECURITY;
