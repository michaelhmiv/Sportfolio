import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const storagePath = fileURLToPath(new URL("./storage.ts", import.meta.url));

function getHolderPayoutActivitySource(): string {
  const source = readFileSync(storagePath, "utf8");
  const start = source.indexOf('if (typeSet.has("payouts"))');
  const end = source.indexOf('if (typeSet.has("premium"))', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("holder payout Activity source contract", () => {
  it("emits processed holder payouts only", () => {
    const source = getHolderPayoutActivitySource();

    expect(source).toContain('eq(sharePayouts.status, "processed")');
    expect(source).not.toContain('ne(sharePayouts.status, "cancelled")');
    expect(source).not.toContain('share_payout_pending');
    expect(source).not.toContain('Holder payout pending');
    expect(source).toContain('type: "share_payout_processed"');
    expect(source).toContain('title: "Holder payout credited"');
  });
});
