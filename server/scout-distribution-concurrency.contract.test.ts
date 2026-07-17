import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const storageSource = readFileSync(resolve(process.cwd(), "server/storage.ts"), "utf8");
const distributionSource = readFileSync(
  resolve(process.cwd(), "server/jobs/scout-distribution.ts"),
  "utf8",
);
const poolSource = readFileSync(resolve(process.cwd(), "server/amm/pool.ts"), "utf8");

describe("scout distribution concurrency contracts", () => {
  it("freezes the alias graph from payout calculation through the complete credit batch", () => {
    expect(distributionSource).toMatch(
      /db\.transaction\([\s\S]*LOCK TABLE player_id_aliases IN SHARE MODE[\s\S]*WITH RECURSIVE alias_paths[\s\S]*creditScoutDistribution/,
    );
  });

  it("serializes alias upserts against distribution and re-keys existing claims", () => {
    const upsert = storageSource.slice(
      storageSource.indexOf("async upsertPlayerIdAlias"),
      storageSource.indexOf("async getPlayersByIds"),
    );
    expect(upsert).toContain("db.transaction");
    expect(upsert).toContain("LOCK TABLE player_id_aliases IN SHARE ROW EXCLUSIVE MODE");
    expect(upsert).toContain("loadPlayerIdentityContext(tx, alias.aliasPlayerId)");
    expect(upsert).toContain("is already bound to");
    expect(upsert).toContain("insert(scoutDistributionClaims)");
    expect(upsert).toContain("onConflictDoNothing");
    expect(upsert).toContain("delete(scoutDistributionClaims)");
  });

  it("uses atomic conflict-safe holding credits for AMM buys and liquidity returns", () => {
    const buy = poolSource.slice(
      poolSource.indexOf("export async function executeBuy"),
      poolSource.indexOf("export async function executeSell"),
    );
    const remove = poolSource.slice(
      poolSource.indexOf("export async function removeLiquidity"),
      poolSource.indexOf("export async function getLpPosition"),
    );

    for (const writer of [buy, remove]) {
      expect(writer).toContain("onConflictDoUpdate");
      expect(writer).toMatch(/quantity:\s*sql`[^`]*excluded\.quantity/s);
    }
  });
});
