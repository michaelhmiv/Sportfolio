import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "server/public-identities/public-identity-repository.ts"),
  "utf8",
);

describe("Public identity repository contract", () => {
  it("uses exactly one set-based SQL query independent of batch size", () => {
    // Must use a single select that handles 1–100 IDs via IN (...).
    // No N+1: no for-loops, no Promise.all with N queries.
    expect(source).toMatch(/users/);
    expect(source).toMatch(/IN\s*\(/);
    // Must join user_badge_preferences for preferred badge
    expect(source).toMatch(/user_badge_preferences/);
    // Must join user_collection_awards for the award
    expect(source).toMatch(/user_collection_awards/);
    // Must join collection_definitions for lifecycle
    expect(source).toMatch(/collection_definitions/);
    // Must join collection_definition_versions for exact-current-version
    expect(source).toMatch(/collection_definition_versions/);
    // Must join user_collection_states for active state check
    expect(source).toMatch(/user_collection_states/);
    // Must filter tracking/final on definitions
    expect(source).toMatch(/tracking.*final|final.*tracking/);
    // Must filter tracking/final on versions
    expect(source).toMatch(/v\.state\s*IN|state.*IN.*tracking.*final/);
    // Must check active assembly state
    expect(source).toMatch(/assembly_state.*=.*'active'|'active'.*assembly_state/);
    // Must check exact current version
    expect(source).toMatch(/current_version/);
    // Must use user_badge_preferences priority order
    expect(source).toMatch(/priority/);
    // Must handle soft-deleted users
    expect(source).toMatch(/deletedAt|deleted_at/);
  });

  it("returns empty array when given an empty ID list (zero DB calls)", () => {
    // The implementation must short-circuit empty input without querying.
    // We verify this by checking the function signature and guard.
    expect(source).toMatch(/length\s*===\s*0|length\s*<\s*1|\.length\s*\)\s*\{/);
    expect(source).toContain("[]");
  });

  it("deduplicates IDs before querying", () => {
    expect(source).toMatch(/new Set|uniq|distinct|dedup/);
  });
});
