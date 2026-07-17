import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const storageSource = readFileSync(resolve(process.cwd(), "server/storage.ts"), "utf8");
const reserveSharesSource = storageSource.slice(
  storageSource.indexOf("async reserveShares("),
  storageSource.indexOf("async adjustLockQuantity("),
);

describe("ordinary holding reservation concurrency contract", () => {
  it("serializes reservations across canonical and alias player holdings", () => {
    expect(reserveSharesSource).toContain("loadPlayerIdentityContext(tx, assetId)");
    expect(reserveSharesSource).toContain("inArray(holdings.assetId, identityIds)");
    expect(reserveSharesSource).toContain(".orderBy(asc(holdings.id))");
    expect(reserveSharesSource).toContain('.for("update")');
  });

  it("compares persisted numeric quantities in PostgreSQL without float arithmetic", () => {
    expect(reserveSharesSource).toContain("${normalizedQuantity}::numeric AS enough");
    expect(reserveSharesSource).toContain("GREATEST(");
    expect(reserveSharesSource).not.toContain("parseFloat(");
    expect(storageSource).not.toContain("Promise.all(normalizedRequests.map");
  });

  it("serializes lock adjustments and stacking across the full player identity", () => {
    const adjustStart = storageSource.indexOf("async adjustLockQuantity");
    const stackStart = storageSource.indexOf("async stackShares");
    const adjustSection = storageSource.slice(
      adjustStart,
      storageSource.indexOf("async getLockedQuantity", adjustStart),
    );
    const stackSection = storageSource.slice(
      stackStart,
      storageSource.indexOf("async getPlayerShareBreakdown", stackStart),
    );

    expect(adjustSection).toContain("db.transaction");
    expect(adjustSection).toContain("loadPlayerIdentityContext");
    expect(adjustSection).toContain("orderBy(asc(holdings.id))");
    expect(adjustSection).toContain("ne(holdingsLocks.lockReferenceId, lockReferenceId)");
    expect(stackSection).toContain("loadPlayerIdentityContext");
    expect(stackSection).toContain("buildIdentityMatchSql(holdings.assetId, identity.allIds)");
    expect(stackSection).toContain("buildIdentityMatchSql(holdingsLocks.assetId, identity.allIds)");
    expect(stackSection).toContain("orderBy(asc(holdings.id))");
    expect(stackSection).toContain("orderBy(asc(holdingsLocks.id))");
    expect(stackSection).toContain("orderBy(asc(playerMultipliers.id))");
  });

  it("uses deterministic holding and multiplier lock order for boost transactions", () => {
    const boostStart = storageSource.indexOf("async lockBoostShares");
    const boostSection = storageSource.slice(
      boostStart,
      storageSource.indexOf("async stackShares", boostStart),
    );

    expect(boostSection).toContain("orderBy(asc(holdings.id))");
    expect(boostSection).toContain("orderBy(asc(holdingsLocks.id))");
    expect(boostSection).toContain("orderBy(asc(playerMultipliers.id))");
  });
});
