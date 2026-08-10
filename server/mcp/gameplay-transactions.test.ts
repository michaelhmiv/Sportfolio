import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelGameplayTransaction,
  configureGameplayTransactionExecutorForTests,
  confirmGameplayTransaction,
  getGameplayTransaction,
  resetGameplayTransactionsForTests,
  stageGameplayTransaction,
} from "./gameplay-transactions";

beforeEach(() => resetGameplayTransactionsForTests());
afterEach(() => resetGameplayTransactionsForTests());

describe("gameplay transactions", () => {
  it("stages and confirms an owned action exactly once", async () => {
    const executor = vi.fn(async () => ({ ok: true }));
    configureGameplayTransactionExecutorForTests(executor);
    const staged = await stageGameplayTransaction({
      userId: "user-1",
      action: { actionType: "scout_set_count", playerId: "player-1", targetCount: 2 },
    });
    expect(staged.status).toBe("pending_confirmation");

    const confirmed = await confirmGameplayTransaction("user-1", staged.transactionId);
    expect(confirmed.status).toBe("confirmed");
    expect(executor).toHaveBeenCalledTimes(1);
    await expect(confirmGameplayTransaction("user-1", staged.transactionId)).rejects.toThrow(
      "confirmed",
    );
  });

  it("stages multiple scout targets as one exact confirmation bundle", async () => {
    const executor = vi.fn(async (_userId, action) => action);
    configureGameplayTransactionExecutorForTests(executor);
    const staged = await stageGameplayTransaction({
      userId: "user-1",
      action: {
        actionType: "scout_set_counts",
        assignments: [
          { playerId: "player-1", targetCount: 1 },
          { playerId: "player-2", targetCount: 2 },
        ],
      },
    });

    expect(staged.status).toBe("pending_confirmation");
    expect(staged.summary).toContain("2 players");

    const confirmed = await confirmGameplayTransaction("user-1", staged.transactionId);
    expect(confirmed.status).toBe("confirmed");
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0]?.[1]).toEqual({
      actionType: "scout_set_counts",
      assignments: [
        { playerId: "player-1", targetCount: 1 },
        { playerId: "player-2", targetCount: 2 },
      ],
    });
  });

  it("rejects duplicate player ids in a scout batch", async () => {
    await expect(
      stageGameplayTransaction({
        userId: "user-1",
        action: {
          actionType: "scout_set_counts",
          assignments: [
            { playerId: "player-1", targetCount: 1 },
            { playerId: "player-1", targetCount: 2 },
          ],
        },
      }),
    ).rejects.toThrow("Duplicate scout assignment");
  });

  it("prevents cross-user access", async () => {
    const staged = await stageGameplayTransaction({
      userId: "user-1",
      action: { actionType: "watchlist_add_player", playerId: "player-1" },
    });
    await expect(getGameplayTransaction("user-2", staged.transactionId)).rejects.toThrow(
      "not found",
    );
  });

  it("cancels without executing", async () => {
    const executor = vi.fn();
    configureGameplayTransactionExecutorForTests(executor);
    const staged = await stageGameplayTransaction({
      userId: "user-1",
      action: { actionType: "watchlist_remove_player", playerId: "player-1" },
    });
    const cancelled = await cancelGameplayTransaction("user-1", staged.transactionId);
    expect(cancelled.status).toBe("cancelled");
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects invalid action quantities", async () => {
    await expect(
      stageGameplayTransaction({
        userId: "user-1",
        action: { actionType: "pool_buy", playerId: "player-1", sbAmount: 0, maxSlippage: 0.05 },
      }),
    ).rejects.toThrow("greater than zero");
  });
});
