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
  });
});
