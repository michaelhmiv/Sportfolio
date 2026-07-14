import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "server/collections/postgres-repository.ts"),
  "utf8",
);
const serviceSource = readFileSync(resolve(process.cwd(), "server/collections/service.ts"), "utf8");

describe("Postgres collection repository contract", () => {
  it("serializes every collection write per user and locks the backing ledger", () => {
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toMatch(/\.from\(holdings\)[\s\S]+?\.for\("update"\)/);
    expect(source).toMatch(/\.from\(holdingsLocks\)[\s\S]+?\.for\("update"\)/);
    expect(source).toContain('code === "40001" || code === "40P01"');
  });

  it("keeps allocation and collection-lock upserts exact and idempotent", () => {
    expect(serviceSource).toContain("normalizeCollectionQuantity");
    expect(source).toMatch(
      /ON CONFLICT \(lock_reference_id\) WHERE lock_type = 'collection'[\s\S]+locked_quantity = EXCLUDED\.locked_quantity/,
    );
    expect(source).toMatch(/SELECT GREATEST\([\s\S]+0::numeric[\s\S]+AS available/);
  });

  it("rotates bounded reconciliation batches by the oldest evaluation time", () => {
    expect(source).toMatch(
      /LEFT JOIN user_collection_states s[\s\S]+ORDER BY s\.evaluated_at ASC NULLS FIRST/,
    );
  });

  it("resolves only explicitly preferred, currently active badges in preference order", () => {
    expect(source).toMatch(/FROM user_badge_preferences p/);
    expect(source).not.toMatch(/LEFT JOIN user_badge_preferences/);
    expect(source).toMatch(/s\.assembly_state = 'active'/);
    expect(source).toMatch(/v\.version = d\.current_version/);
    expect(source).toMatch(/ORDER BY p\.priority ASC/);
  });
});
