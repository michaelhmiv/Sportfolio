import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const migrationPath = resolve(repositoryRoot, "migrations/0049_collections_domain_v2.sql");

const expectedTables = {
  collectionDefinitions: "collection_definitions",
  collectionDefinitionVersions: "collection_definition_versions",
  collectionSlots: "collection_slots",
  collectionPrerequisites: "collection_prerequisites",
  userCollectionAllocations: "user_collection_allocations",
  userCollectionStates: "user_collection_states",
  userCollectionAwards: "user_collection_awards",
  userCollectionStateEvents: "user_collection_state_events",
  userBadgePreferences: "user_badge_preferences",
  userFeaturedCollections: "user_featured_collections",
} as const;

describe("collections v2 domain schema contract", () => {
  it("exports each required domain table under a stable name", async () => {
    const schema = (await import("@shared/schema")) as Record<string, unknown>;

    for (const [exportName, tableName] of Object.entries(expectedTables)) {
      const table = schema[exportName];
      expect(table, `${exportName} must be exported`).toBeDefined();
      expect(getTableConfig(table as Parameters<typeof getTableConfig>[0]).name).toBe(tableName);
    }
  });

  it("keeps definition, assembly, historical award, and identity concerns separate", async () => {
    const schema = (await import("@shared/schema")) as Record<string, unknown>;

    const versionColumns = getTableConfig(
      schema.collectionDefinitionVersions as Parameters<typeof getTableConfig>[0],
    ).columns.map((column) => column.name);
    expect(versionColumns).toEqual(
      expect.arrayContaining([
        "definition_id",
        "version",
        "title",
        "qualification_rules",
        "source_type",
        "source_uri",
        "art_key",
        "state",
        "finalized_at",
      ]),
    );

    const allocationColumns = getTableConfig(
      schema.userCollectionAllocations as Parameters<typeof getTableConfig>[0],
    ).columns.map((column) => column.name);
    expect(allocationColumns).toEqual(
      expect.arrayContaining([
        "user_id",
        "collection_slot_id",
        "player_id",
        "allocated_quantity",
        "lock_reference_id",
      ]),
    );

    const stateColumns = getTableConfig(
      schema.userCollectionStates as Parameters<typeof getTableConfig>[0],
    ).columns.map((column) => column.name);
    expect(stateColumns).toEqual(
      expect.arrayContaining([
        "assembly_state",
        "allocated_quantity",
        "required_quantity",
        "progress_bps",
        "activated_at",
        "deactivated_at",
      ]),
    );

    const awardColumns = getTableConfig(
      schema.userCollectionAwards as Parameters<typeof getTableConfig>[0],
    ).columns.map((column) => column.name);
    expect(awardColumns).toEqual(
      expect.arrayContaining(["first_completed_at", "completion_sequence", "rarity_snapshot"]),
    );
  });

  it("keeps every Drizzle check constraint aligned with the migration", async () => {
    const schema = (await import("@shared/schema")) as Record<string, unknown>;
    const tableConfigs = Object.keys(expectedTables).map((exportName) =>
      getTableConfig(schema[exportName] as Parameters<typeof getTableConfig>[0]),
    );
    const drizzleChecks = tableConfigs
      .flatMap((config) => config.checks.map((constraint) => constraint.name))
      .sort();
    const migration = readFileSync(migrationPath, "utf8");
    const migrationChecks = Array.from(
      migration.matchAll(/\bCONSTRAINT\s+([a-z0-9_]+_check)\b/g),
      (match) => match[1],
    ).sort();

    expect(drizzleChecks).toEqual(migrationChecks);

    const versionConfig = getTableConfig(
      schema.collectionDefinitionVersions as Parameters<typeof getTableConfig>[0],
    );
    expect(versionConfig.foreignKeys.map((foreignKey) => foreignKey.getName())).toContain(
      "collection_versions_correction_fk",
    );
  });

  it("uses exact decimal quantities and a unique collection lock reference", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(/ALTER COLUMN locked_quantity TYPE numeric\(20,\s*4\)/i);
    expect(migration).toMatch(/lock_type[^\n]+collection/i);
    expect(migration).toContain("locks_collection_reference_unique");
    expect(migration).toMatch(/allocated_quantity numeric\(20,\s*4\)/i);
    expect(migration).toMatch(/required_quantity numeric\(20,\s*4\)/i);
    expect(migration).toContain("collection allocation quantity exceeds slot requirement");
  });

  it("database-protects finalized definition versions and their membership", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("prevent_final_collection_version_mutation");
    expect(migration).toContain("collection_slots_final_immutable");
    expect(migration).toContain("collection_prerequisites_final_immutable");
    expect(migration).toMatch(/FROM collection_definition_versions[\s\S]+FOR UPDATE/i);
    expect(migration).toMatch(
      /RAISE EXCEPTION[^;]+final collection (?:definition versions|membership)/is,
    );
  });

  it("preserves allocation, slot, and holdings-lock integrity", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("prevent_slot_change_with_active_allocations");
    expect(migration).toContain("validate_collection_slot_allocations");
    expect(migration).toContain("collection_slots_allocations_valid");
    expect(migration).toContain("user_collection_allocations_slot_valid");
    expect(migration).toContain("validate_collection_lock_allocation_pair");
    expect(migration).toContain("user_collection_allocations_lock_pair_valid");
    expect(migration).toContain("holdings_locks_collection_allocation_valid");
    expect(migration).toMatch(/DEFERRABLE INITIALLY DEFERRED/i);
    expect(migration).toMatch(
      /FROM collection_slots[\s\S]+WHERE id = NEW\.collection_slot_id[\s\S]+FOR UPDATE/i,
    );
  });

  it("prevents version reparenting from invalidating dependent definition pairs", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("prevent_collection_version_reparenting");
    expect(migration).toMatch(/collection version definition_id is immutable/i);
  });

  it("makes publication irreversible and serializes it with identity changes", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("prevent_collection_unpublication");
    expect(migration).toContain("validate_collection_publication_consistency");
    expect(migration).toMatch(/published collection definitions cannot return to draft/i);
    expect(migration).toMatch(/published collection versions cannot return to draft/i);
    expect(migration).toMatch(
      /FROM collection_definitions[\s\S]+WHERE id = NEW\.definition_id[\s\S]+FOR UPDATE/i,
    );
  });

  it("serializes definition-kind changes with membership writes", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(
      /JOIN collection_definitions definition[\s\S]+WHERE version\.id = NEW\.collection_version_id[\s\S]+FOR UPDATE OF definition/i,
    );
    expect(migration).toMatch(
      /JOIN collection_definitions definition[\s\S]+WHERE version\.id = NEW\.master_version_id[\s\S]+FOR UPDATE OF definition/i,
    );
    expect(migration).toContain("validate_collection_definition_membership");
    expect(migration).toContain("collection_definitions_membership_valid");
    expect(migration).toContain("collection_slots_definition_kind_valid");
    expect(migration).toContain("collection_prerequisites_definition_kind_valid");
  });

  it("requires each definition current-version pointer to resolve at commit", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("validate_collection_current_version_pointer");
    expect(migration).toContain("collection_definitions_current_version_valid");
    expect(migration).toContain("collection_versions_current_pointer_valid");
    expect(migration).toContain("serialize_collection_version_definition_mutation");
    expect(migration).toContain("collection_versions_definition_serialized");
  });

  it("bounds immutable reward metadata", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("user_collection_awards_reward_metadata_size_check");
    expect(migration).toMatch(/octet_length\(reward_metadata::text\) <= 16384/i);
  });

  it("keeps awards immutable without blocking account-deletion cascades", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("user_collection_awards_immutable");
    expect(migration).toMatch(
      /prevent_collection_award_mutation[\s\S]+TG_OP = 'DELETE'[\s\S]+NOT EXISTS[\s\S]+FROM users[\s\S]+OLD\.user_id/i,
    );
  });

  it("keeps state-event audit rows append-only without blocking account-deletion cascades", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("prevent_collection_state_event_mutation");
    expect(migration).toContain("user_collection_state_events_immutable");
    expect(migration).toContain("collection state events are append-only");
  });

  it("protects published logical collection identity from historical rewrites", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("prevent_published_collection_identity_mutation");
    expect(migration).toContain("prevent_published_collection_definition_delete");
    expect(migration).toMatch(
      /collection identity is immutable after publication[\s\S]+ERRCODE = '55000'/i,
    );
    expect(migration).toMatch(/published collections cannot be deleted; disable them instead/i);
  });

  it("requires corrections to target an earlier final version of the same definition", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("validate_collection_correction_reference");
    expect(migration).toMatch(
      /correction target must be an earlier final version of the same collection definition[\s\S]+ERRCODE = '23514'/i,
    );
  });

  it("keeps direct player slots off master collections and prerequisites off player-slot collections", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("validate_collection_membership_kind");
    expect(migration).toMatch(/master collections cannot contain player slots/i);
    expect(migration).toMatch(/only master collections can declare prerequisites/i);
  });

  it("protects finalized membership when a row is moved between versions", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(
      /TG_TABLE_NAME = 'collection_slots'[\s\S]+TG_OP = 'UPDATE'[\s\S]+OLD\.collection_version_id[\s\S]+NEW\.collection_version_id/i,
    );
    expect(migration).toMatch(
      /TG_TABLE_NAME = 'collection_prerequisites'[\s\S]+TG_OP = 'UPDATE'[\s\S]+OLD\.master_version_id[\s\S]+NEW\.master_version_id/i,
    );
  });

  it("does not translate legacy possession rows into factual awards", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).not.toMatch(
      /INSERT\s+INTO\s+user_collection_awards[\s\S]+FROM\s+user_collections/i,
    );
  });
});
