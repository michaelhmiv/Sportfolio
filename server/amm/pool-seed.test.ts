import { describe, expect, it } from "vitest";

import {
  INITIAL_POOL_K,
  INITIAL_POOL_PLAY_MONEY,
  INITIAL_POOL_SHARES,
  shouldRepairSeedLiquidity,
} from "./pool-seed";

describe("pool seed repair detection", () => {
  it("repairs zero-trade pools with mismatched k", () => {
    expect(
      shouldRepairSeedLiquidity({
        shares: INITIAL_POOL_SHARES.toString(),
        playMoney: INITIAL_POOL_PLAY_MONEY.toString(),
        k: "10000000.00",
        lpSharesTotal: INITIAL_POOL_SHARES.toString(),
        totalTrades: 0,
      }),
    ).toBe(true);
  });

  it("does not repair aligned seeded pools", () => {
    expect(
      shouldRepairSeedLiquidity({
        shares: INITIAL_POOL_SHARES.toString(),
        playMoney: INITIAL_POOL_PLAY_MONEY.toString(),
        k: INITIAL_POOL_K.toFixed(2),
        lpSharesTotal: INITIAL_POOL_SHARES.toString(),
        totalTrades: 0,
      }),
    ).toBe(false);
  });
});
