import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositorySource = readFileSync(
  fileURLToPath(new URL("./repository.ts", import.meta.url)),
  "utf8",
);

describe("economy repository PostgreSQL SQL contracts", () => {
  it("types base-settlement jsonb metadata parameters explicitly", () => {
    const fragments = [
      "'economyVersion', ${ECONOMY_VERSION}::text",
      "'gameEpsSb', ${decimal(math.gameEpsSb, 8)}::numeric",
      "'seasonPhase', ${seasonPhase}::text",
      "'economyClass', ${economyClass}::text",
    ];

    for (const fragment of fragments) {
      expect(repositorySource).toContain(fragment);
    }
  });

  it("types direct-share Daily Boost jsonb metadata parameters explicitly", () => {
    const fragments = [
      "'boostId', ${boostId}::text",
      "'economyVersion', ${ECONOMY_VERSION}::text",
      "'slotTier', ${Number(row.slot_tier)}::integer",
      "'communityBoostCount', ${Math.max(0, communityBoostCount)}::integer",
      "'gameEpsSb', ${decimal(gameEpsSb, 8)}::numeric",
    ];

    for (const fragment of fragments) {
      expect(repositorySource).toContain(fragment);
    }
  });

  it("retains the exactly-once settlement guards", () => {
    const guards = [
      "SELECT status FROM player_game_earnings WHERE id = ${row.earnings_id} FOR UPDATE",
      "AND sp.status = 'pending'",
      "WHERE sp.id = payable.id AND sp.status = 'pending'",
      "status = 'processed'",
      "ON CONFLICT (boost_id) DO NOTHING",
    ];

    for (const guard of guards) {
      expect(repositorySource).toContain(guard);
    }
  });
});
