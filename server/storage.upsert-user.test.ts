import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  existingUser: null as Record<string, unknown> | null,
  canonicalUser: null as Record<string, unknown> | null,
  updateResult: [] as Record<string, unknown>[],
  targetUpdate: null as Record<string, unknown> | null,
  canonicalUpdate: null as Record<string, unknown> | null,
}));

vi.mock("./db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => (state.existingUser ? [state.existingUser] : [])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        state.targetUpdate = values;
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => state.updateResult),
          })),
        };
      }),
    })),
    transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              for: vi.fn(async () => (state.canonicalUser ? [state.canonicalUser] : [])),
            })),
          })),
        })),
        update: vi.fn(() => ({
          set: vi.fn((values: Record<string, unknown>) => {
            state.canonicalUpdate = values;
            return {
              where: vi.fn(() => ({
                returning: vi.fn(async () => (state.canonicalUser ? [state.canonicalUser] : [])),
              })),
            };
          }),
        })),
      };
      return callback(tx);
    }),
  },
}));

import { DatabaseStorage } from "./storage";

describe("DatabaseStorage.upsertUser identity durability", () => {
  beforeEach(() => {
    state.existingUser = {
      id: "canonical-deleted-user",
      authProviderSubject: "deleted-user",
      email: null,
      firstName: null,
      lastName: null,
      profileImageUrl: null,
      username: "deleted_deleted-user",
      deletedAt: new Date("2026-07-15T00:00:00.000Z"),
    };
    state.updateResult = [];
    state.targetUpdate = null;
    state.canonicalUser = null;
    state.canonicalUpdate = null;
  });

  it("rejects identity synchronization when the target row is soft-deleted", async () => {
    const storage = new DatabaseStorage();

    await expect(
      storage.upsertUser({
        id: "deleted-user",
        email: "restored@example.com",
        firstName: "Restored",
        lastName: "Person",
        profileImageUrl: "https://example.com/avatar.png",
        username: "restored",
      }),
    ).rejects.toMatchObject({ code: "USER_DELETED" });
  });

  it("keeps the canonical user id and private profile when auth supplies a replacement id", async () => {
    state.existingUser = null;
    state.canonicalUser = {
      id: "canonical-user",
      email: "owner@example.com",
      username: "owner",
      firstName: "Original",
      lastName: "Owner",
      profileImageUrl: null,
      profileVisibility: "private",
      deletedAt: null,
    };

    const storage = new DatabaseStorage();
    const result = await storage.upsertUser({
      id: "replacement-auth-id",
      email: "owner@example.com",
      firstName: "Updated",
      lastName: "Owner",
      profileImageUrl: null,
      username: "owner",
    });

    expect(result.id).toBe("canonical-user");
    expect(result.profileVisibility).toBe("private");
    expect(state.canonicalUpdate?.authProviderSubject).toBe("replacement-auth-id");
    expect(state.canonicalUpdate).not.toHaveProperty("profileVisibility");
  });

  it("preserves the newest provider subject when an older recorded subject authenticates", async () => {
    state.existingUser = {
      id: "canonical-user",
      authProviderSubject: "replacement-auth-id",
      authProviderSubjects: ["original-auth-id", "replacement-auth-id"],
      email: "owner@example.com",
      username: "owner",
      deletedAt: null,
    };
    state.updateResult = [state.existingUser];

    await new DatabaseStorage().upsertUser({
      id: "original-auth-id",
      email: "owner@example.com",
      username: "owner",
    });

    expect(state.targetUpdate?.authProviderSubject).toBe("replacement-auth-id");
    expect(state.targetUpdate).toHaveProperty("authProviderSubjects");
  });
});
