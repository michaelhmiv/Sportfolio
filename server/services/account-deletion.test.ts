import {
  accountDeletionRequests,
  authUsers,
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
    then: (resolve: (value: unknown[]) => unknown, reject: (reason?: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
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
    const processingRequest = buildRequest({ status: "provider_cleanup_pending" });
    const completedRequest = buildRequest({ status: "completed" });
    const user = {
      id: request.userId,
      email: "delete@example.com",
      username: "deleteme",
      authProviderSubject: request.userId,
      authProviderSubjects: [request.userId],
      deletedAt: null,
    };

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
        return { where: vi.fn(() => Promise.resolve()) };
      }),
    };

    let selectCall = 0;
    Object.assign(mocks.db, {
      select: vi.fn(() => {
        selectCall += 1;
        return selectCall === 1
          ? selectChain([request])
          : selectChain([{ authUserId: "better-auth-user-1" }]);
      }),
      transaction: vi.fn((callback: (executor: typeof tx) => unknown) => callback(tx)),
      delete: vi.fn((table: unknown) => {
        mocks.deletedTables.push(table);
        return { where: vi.fn(() => Promise.resolve()) };
      }),
      update: vi.fn((table: unknown) =>
        updateChain(table === accountDeletionRequests ? [completedRequest] : []),
      ),
    });
  });

  it("erases local data and deletes the mapped Better Auth identity", async () => {
    const result = await processDueAccountDeletionRequests(new Date("2026-07-15T11:00:00.000Z"));

    expect(result).toEqual({ scanned: 1, completed: 1, failed: 0 });
    expect(mocks.deletedTables).toContain(userBadgePreferences);
    expect(mocks.deletedTables).toContain(userFeaturedCollections);
    expect(mocks.deletedTables).toContain(userPushDevices);
    expect(mocks.deletedTables).toContain(userPushTokens);
    expect(mocks.deletedTables).toContain(authUsers);

    const transaction = mocks.db.transaction as ReturnType<typeof vi.fn>;
    expect(transaction).toHaveBeenCalledOnce();

    const update = mocks.db.update as ReturnType<typeof vi.fn>;
    expect(update).toHaveBeenCalledWith(accountDeletionRequests);
    expect(update).not.toHaveBeenCalledWith(users);
  });
});
