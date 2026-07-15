import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeUser: null as { id: string } | null,
  locked: false,
  inserted: false,
}));

vi.mock("./db", () => ({
  db: {
    transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              for: vi.fn(async (lock: string) => {
                state.locked = lock === "update";
                return state.activeUser ? [state.activeUser] : [];
              }),
            })),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn(async () => {
              state.inserted = true;
              return [{ id: "token-1", userId: "user-1" }];
            }),
          })),
        })),
      };
      return callback(tx);
    }),
  },
}));

import { DatabaseStorage } from "./storage";

const token = {
  id: "token-1",
  userId: "user-1",
  name: "CLI",
  tokenPrefix: "spf_test",
  tokenHash: "hash",
};

describe("DatabaseStorage.createUserApiToken deletion serialization", () => {
  beforeEach(() => {
    state.activeUser = null;
    state.locked = false;
    state.inserted = false;
  });

  it("locks and verifies the active user before inserting", async () => {
    state.activeUser = { id: "user-1" };

    await expect(new DatabaseStorage().createUserApiToken(token)).resolves.toMatchObject({
      id: "token-1",
    });
    expect(state.locked).toBe(true);
    expect(state.inserted).toBe(true);
  });

  it("does not insert after account deletion wins the user-row lock", async () => {
    await expect(new DatabaseStorage().createUserApiToken(token)).rejects.toThrow(
      "deleted or missing user",
    );
    expect(state.locked).toBe(true);
    expect(state.inserted).toBe(false);
  });
});
