import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositorySource = readFileSync(
  fileURLToPath(new URL("./repository.ts", import.meta.url)),
  "utf8",
);

describe("economy repository PostgreSQL SQL contracts", () => {
  it("types base-settlement jsonb metadata parameters explicitly", () => {
    expect(repositorySource).toContain("'economyVersion', ${ECONOMY_VERSION}::text");
    expect(repositorySource).toContain("'gameEpsSb', ${decimal(math.gameEpsSb, 8)}::numeric");
    expect(repositorySource).toContain("'seasonPhase', ${seasonPhase}::text");
    expect(repositorySource).toContain("'economyClass', ${economyClass}::text");
  });

  it("types direct-share Daily Boost jsonb metadata parameters explicitly", () => {
    expect(repositorySource).toContain("'boostId', ${boostId}::text");
    expect(repositorySource).toContain("'economyVersion', ${ECONOMY_VERSION}::text");
    expect(repositorySource).toContain("'slotTier', ${Number(row.slot_tier)}::integer");
    expect(repositorySource).toContain(
      "'communityBoostCount', ${Math.max(0, communityBoostCount)}::integer",
    );
    expect(repositorySource).toContain("'gameEpsSb', ${decimal(gameEpsSb, 8)}::numeric");
  });

  it("retains the exactly-once settlement guards", () => {
    expect(repositorySource).toContain(
      "SELECT status FROM player_game_earnings WHERE id = ${row.earnings_id} FOR UPDATE",
    );
    expect(repositorySource).toContain("AND sp.status = 'pending'");
    expect(repositorySource).toContain(
      "WHERE sp.id = payable.id AND sp.status = 'pending'",
    );
    expect(repositorySource).toContain("status = 'processed'");
    expect(repositorySource).toContain("ON CONFLICT (boost_id) DO NOTHING");
  });
});
