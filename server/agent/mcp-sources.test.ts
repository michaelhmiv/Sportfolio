import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const execute = vi.fn();
  const orderBy = vi.fn();
  const where = vi.fn(() => ({
    orderBy,
  }));
  const from = vi.fn(() => ({
    where,
  }));
  const select = vi.fn(() => ({
    from,
  }));

  return {
    db: {
      execute,
      select,
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    execute,
    orderBy,
    where,
    from,
    select,
  };
});

vi.mock("../db", () => ({
  db: mocks.db,
}));

import { listUserMcpSources } from "./mcp-sources";

describe("mcp-sources schema bootstrap", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.orderBy.mockReset();
    mocks.where.mockClear();
    mocks.from.mockClear();
    mocks.select.mockClear();

    let attempt = 0;
    mocks.orderBy.mockImplementation(() => {
      if (attempt === 0) {
        attempt += 1;
        return Promise.reject(new Error('relation "user_mcp_sources" does not exist'));
      }

      return Promise.resolve([]);
    });
  });

  it("bootstraps and retries when listing sources hits a missing schema", async () => {
    const sources = await listUserMcpSources("user_1");

    expect(sources).toEqual([]);
    expect(mocks.orderBy).toHaveBeenCalledTimes(2);
    expect(mocks.execute).toHaveBeenCalledTimes(6);
  });
});
