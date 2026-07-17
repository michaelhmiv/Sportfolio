-- Split the collection pair-identity guard by table. PostgreSQL record fields are
-- resolved against the firing table, so a shared trigger function must not access
-- holdings_locks.lock_type while handling user_collection_allocations.

DROP TRIGGER IF EXISTS user_collection_allocations_lock_reference_immutable
  ON user_collection_allocations;
DROP TRIGGER IF EXISTS holdings_locks_collection_reference_immutable
  ON holdings_locks;
DROP FUNCTION IF EXISTS prevent_collection_pair_identity_mutation();

CREATE OR REPLACE FUNCTION prevent_collection_allocation_reference_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.lock_reference_id IS DISTINCT FROM NEW.lock_reference_id THEN
    RAISE EXCEPTION 'collection allocation lock reference is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_collection_holdings_lock_reference_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (OLD.lock_type = 'collection' OR NEW.lock_type = 'collection')
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
EXECUTE FUNCTION prevent_collection_allocation_reference_mutation();

CREATE TRIGGER holdings_locks_collection_reference_immutable
BEFORE UPDATE OF lock_reference_id, lock_type ON holdings_locks
FOR EACH ROW
EXECUTE FUNCTION prevent_collection_holdings_lock_reference_mutation();
