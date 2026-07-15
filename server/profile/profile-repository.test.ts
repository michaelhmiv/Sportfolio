import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mockDb = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("../db", () => ({ db: mockDb }));

import { userBadgePreferences, userFeaturedCollections, users } from "@shared/schema";
import { getAwardsWithDefinitionsAndStates, lockAndReplaceTrophyCase } from "./profile-repository";

type State = {
  visibility: "public" | "private";
  badges: string[];
  featured: string[];
};

describe("getAwardsWithDefinitionsAndStates", () => {
  it("joins an award to the exact current version id", async () => {
    const dialect = new PgDialect();
    const joins: string[] = [];
    const chain: any = {
      innerJoin: (_table: unknown, condition: any) => {
        joins.push(dialect.sqlToQuery(condition).sql);
        return chain;
      },
      leftJoin: () => chain,
      where: async () => [],
    };
    const executor = {
      select: () => ({ from: () => chain }),
    };

    await getAwardsWithDefinitionsAndStates("user-1", executor);

    expect(
      joins.some(
        (join) =>
          join.includes(
            '"collection_definition_versions"."id" = "user_collection_awards"."collection_version_id"',
          ) &&
          join.includes(
            '"collection_definition_versions"."version" = "collection_definitions"."current_version"',
          ),
      ),
    ).toBe(true);
  });
});

function clone(state: State): State {
  return {
    visibility: state.visibility,
    badges: [...state.badges],
    featured: [...state.featured],
  };
}

function installTransactionalFake(
  committed: State,
  options: { userExists?: boolean; failFeaturedInsert?: boolean } = {},
) {
  const events: string[] = [];

  mockDb.transaction.mockImplementation(async (callback: (tx: any) => Promise<void>) => {
    const working = clone(committed);
    let executeIndex = 0;
    const tx = {
      execute: vi.fn(async () => {
        const labels = ["lock-user", "lock-eligibility", "lock-badge-states"];
        events.push(labels[executeIndex] ?? "unexpected-lock");
        const rows = executeIndex === 0 && options.userExists !== false ? [{ id: "user-1" }] : [];
        executeIndex += 1;
        return { rows };
      }),
      update: vi.fn((table: unknown) => {
        expect(table).toBe(users);
        return {
          set: (values: { profileVisibility: State["visibility"] }) => ({
            where: async () => {
              events.push("update-visibility");
              working.visibility = values.profileVisibility;
            },
          }),
        };
      }),
      delete: vi.fn((table: unknown) => ({
        where: async () => {
          if (table === userBadgePreferences) {
            events.push("delete-badges");
            working.badges = [];
          } else if (table === userFeaturedCollections) {
            events.push("delete-featured");
            working.featured = [];
          } else {
            throw new Error("unexpected delete table");
          }
        },
      })),
      insert: vi.fn((table: unknown) => ({
        values: async (rows: Array<{ collectionDefinitionId: string }>) => {
          if (table === userBadgePreferences) {
            events.push("insert-badges");
            working.badges = rows.map((row) => row.collectionDefinitionId);
            return;
          }
          if (table === userFeaturedCollections) {
            events.push("insert-featured");
            if (options.failFeaturedInsert) throw new Error("featured insert failed");
            working.featured = rows.map((row) => row.collectionDefinitionId);
            return;
          }
          throw new Error("unexpected insert table");
        },
      })),
    };

    await callback(tx);
    Object.assign(committed, clone(working));
  });

  return events;
}

describe("lockAndReplaceTrophyCase", () => {
  beforeEach(() => {
    mockDb.transaction.mockReset();
  });

  it("locks before atomically replacing visibility and both ordered lists", async () => {
    const committed: State = {
      visibility: "public",
      badges: ["old-badge"],
      featured: ["old-featured"],
    };
    const events = installTransactionalFake(committed);

    await lockAndReplaceTrophyCase("user-1", "private", ["badge-a", "badge-b"], ["featured-a"]);

    expect(committed).toEqual({
      visibility: "private",
      badges: ["badge-a", "badge-b"],
      featured: ["featured-a"],
    });
    expect(events).toEqual([
      "lock-user",
      "lock-eligibility",
      "lock-badge-states",
      "update-visibility",
      "delete-badges",
      "insert-badges",
      "delete-featured",
      "insert-featured",
    ]);
  });

  it("rolls back visibility and both preference lists when the final insert fails", async () => {
    const committed: State = {
      visibility: "public",
      badges: ["old-badge"],
      featured: ["old-featured"],
    };
    installTransactionalFake(committed, { failFeaturedInsert: true });

    await expect(
      lockAndReplaceTrophyCase("user-1", "private", ["new-badge"], ["new-featured"]),
    ).rejects.toThrow("featured insert failed");

    expect(committed).toEqual({
      visibility: "public",
      badges: ["old-badge"],
      featured: ["old-featured"],
    });
  });

  it("does not write when the locked user does not exist", async () => {
    const committed: State = {
      visibility: "public",
      badges: ["old-badge"],
      featured: ["old-featured"],
    };
    const events = installTransactionalFake(committed, { userExists: false });

    await expect(lockAndReplaceTrophyCase("missing", "private", [], [])).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(events).toEqual(["lock-user"]);
    expect(committed.visibility).toBe("public");
  });

  it("treats a soft-deleted user as missing at the mutation lock", async () => {
    const dialect = new PgDialect();
    let lockSql = "";
    mockDb.transaction.mockImplementation(async (callback: (tx: any) => Promise<void>) => {
      await callback({
        execute: vi.fn(async (query: any) => {
          lockSql = dialect.sqlToQuery(query).sql;
          return { rows: [] };
        }),
      });
    });

    await expect(lockAndReplaceTrophyCase("deleted-user", "public", [], [])).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(lockSql).toContain("deleted_at IS NULL");
    expect(lockSql).toContain("FOR UPDATE");
  });

  it("revalidates after locking and before the first write", async () => {
    const committed: State = {
      visibility: "public",
      badges: ["old-badge"],
      featured: ["old-featured"],
    };
    const events = installTransactionalFake(committed);
    const staleSelection = Object.assign(new Error("selection became stale"), {
      statusCode: 422,
    });

    await expect(
      lockAndReplaceTrophyCase("user-1", "private", ["new-badge"], ["new-featured"], async () => {
        events.push("revalidate");
        throw staleSelection;
      }),
    ).rejects.toBe(staleSelection);

    expect(events).toEqual(["lock-user", "lock-eligibility", "lock-badge-states", "revalidate"]);
    expect(committed).toEqual({
      visibility: "public",
      badges: ["old-badge"],
      featured: ["old-featured"],
    });
  });
});
