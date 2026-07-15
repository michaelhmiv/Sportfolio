import {
  accountDeletionRequests,
  userBadgePreferences,
  userFeaturedCollections,
  userPushDevices,
  userPushTokens,
  users,
  type AccountDeletionRequest,
} from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
  deletedTables: [] as unknown[],
  deleteAuthUser: vi.fn(),
}));

vi.hoisted(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { admin: { deleteUser: mocks.deleteAuthUser } },
  })),
}));

vi.mock("../db", () => ({ db: mocks.db }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { processDueAccountDeletionRequests } from "./account-deletion";

function buildRequest(overrides: Partial<AccountDeletionRequest> = {}): AccountDeletionRequest {
  return {
    id: "deletion-request-1",
    userId: "user-account-delete",
    status: "pending",
    reason: null,
    details: null,
    requestedAt: new Date("2026-07-14T10:00:00.000Z"),
    effectiveAt: new Date("2026-07-15T10:00:00.000Z"),
    cancelledAt: null,
    processedAt: null,
    retainedRecordsNote: null,
    metadata: {},
    ...overrides,
  };
}

function selectChain(result: unknown[]) {
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(result)),
    for: vi.fn(() => Promise.resolve(result)),
  };
  return chain;
}

function updateChain(returned: unknown[] = []) {
  const chain: any = {
    set: vi.fn(() => chain),
    where: vi.fn(() => chain),
    returning: vi.fn(() => Promise.resolve(returned)),
  };
  return chain;
}

describe("account deletion processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deletedTables.length = 0;

    const request = buildRequest();
    const processingRequest = buildRequest({ status: "processing" });
    const completedRequest = buildRequest({ status: "completed" });
    const user = {
      id: request.userId,
      authProviderSubject: "replacement-auth-provider-id",
      authProviderSubjects: [
        request.userId,
        "original-auth-provider-id",
        "replacement-auth-provider-id",
      ],
      deletedAt: null,
    };

    mocks.deleteAuthUser.mockResolvedValue({
      error: new Error("provider unavailable"),
    });

    const tx = {
      select: vi
        .fn()
        .mockImplementationOnce(() => selectChain([request]))
        .mockImplementationOnce(() => selectChain([user])),
      update: vi.fn((table: unknown) =>
        updateChain(table === accountDeletionRequests ? [processingRequest] : []),
      ),
      delete: vi.fn((table: unknown) => {
        mocks.deletedTables.push(table);
        const chain: any = { where: vi.fn(() => Promise.resolve()) };
        return chain;
      }),
    };

    Object.assign(mocks.db, {
      select: vi.fn(() => selectChain([request])),
      transaction: vi.fn((callback: (executor: typeof tx) => unknown) => callback(tx)),
      update: vi.fn((table: unknown) =>
        updateChain(table === accountDeletionRequests ? [completedRequest] : []),
      ),
    });
  });

  it("erases local data and keeps provider cleanup retryable when auth deletion fails", async () => {
    const result = await processDueAccountDeletionRequests(new Date("2026-07-15T11:00:00.000Z"));

    expect(result).toEqual({ scanned: 1, completed: 0, failed: 1 });
    expect(mocks.deletedTables).toContain(userBadgePreferences);
    expect(mocks.deletedTables).toContain(userFeaturedCollections);
    expect(mocks.deletedTables).toContain(userPushDevices);
    expect(mocks.deletedTables).toContain(userPushTokens);
    expect(mocks.deletedTables).toHaveLength(4);
    expect(mocks.deleteAuthUser.mock.calls.map(([subject]) => subject)).toEqual([
      "user-account-delete",
      "original-auth-provider-id",
      "replacement-auth-provider-id",
    ]);

    const transaction = mocks.db.transaction as ReturnType<typeof vi.fn>;
    expect(transaction).toHaveBeenCalledOnce();

    const update = mocks.db.update as ReturnType<typeof vi.fn>;
    expect(update).toHaveBeenCalledWith(accountDeletionRequests);
    expect(update).not.toHaveBeenCalledWith(users);
  });
});
