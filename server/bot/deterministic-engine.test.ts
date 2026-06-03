import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  dbExecute: vi.fn(),
  dbInsert: vi.fn(),
  dbUpdate: vi.fn(),
  storageAssignScouts: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    select: mocks.dbSelect,
    execute: mocks.dbExecute,
    insert: mocks.dbInsert,
    update: mocks.dbUpdate,
  },
}));

vi.mock("../storage", () => ({
  storage: {
    assignScouts: mocks.storageAssignScouts,
  },
}));

vi.mock("./action-executor", () => ({
  executeBotAction: vi.fn(),
  calculateActionParams: vi.fn(),
}));

import {
  __deterministicEngineTestHooks,
  computeClampedSportTargets,
  isBotEngineEnabled,
} from "./deterministic-engine";

function collectSqlStrings(value: unknown, seen = new Set<object>()): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (value === null || value === undefined || typeof value !== "object") {
    return [];
  }

  if (seen.has(value as object)) {
    return [];
  }

  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectSqlStrings(entry, seen));
  }

  return Object.values(value as Record<string, unknown>).flatMap((entry) =>
    collectSqlStrings(entry, seen),
  );
}

function createSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = async () => rows;
  chain.groupBy = () => chain;
  chain.orderBy = () => chain;
  chain.limit = async () => rows;
  return chain;
}

describe("deterministic-engine policy utilities", () => {
  beforeEach(() => {
    mocks.dbSelect.mockReset();
    mocks.dbExecute.mockReset();
    mocks.dbInsert.mockReset();
    mocks.dbUpdate.mockReset();
    mocks.storageAssignScouts.mockReset();

    const selectQueue: unknown[][] = [[{ balance: "10000" }], []];

    mocks.dbSelect.mockImplementation(() => createSelectChain(selectQueue.shift() || []));

    mocks.dbExecute.mockImplementation((query: unknown) => {
      const sqlText = collectSqlStrings(query).join(" ");

      if (/operation\s*=\s*'add'/i.test(sqlText)) {
        throw new Error('column "operation" does not exist');
      }

      if (/from holdings/i.test(sqlText)) {
        return Promise.resolve({
          rows: [
            {
              unique_players: 0,
              total_shares: 0,
            },
          ],
        });
      }

      if (/from lp_positions/i.test(sqlText)) {
        return Promise.resolve({
          rows: [
            {
              lp_count: 0,
            },
          ],
        });
      }

      if (/from lp_transactions/i.test(sqlText)) {
        return Promise.resolve({
          rows: [
            {
              pools_created: 1,
            },
          ],
        });
      }

      return Promise.resolve({ rows: [] });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses BOT_ENGINE_ENABLED values correctly", () => {
    expect(isBotEngineEnabled(undefined)).toBe(true);
    expect(isBotEngineEnabled("true")).toBe(true);
    expect(isBotEngineEnabled("false")).toBe(false);
    expect(isBotEngineEnabled("0")).toBe(false);
    expect(isBotEngineEnabled("off")).toBe(false);
  });

  it("computes clamped, normalized sport targets", () => {
    const targets = computeClampedSportTargets(
      new Map([
        ["NBA", 10],
        ["NFL", 3],
        ["MLB", 1],
      ]),
      0.15,
      0.55,
    );

    const nba = targets.get("NBA") || 0;
    const nfl = targets.get("NFL") || 0;
    const mlb = targets.get("MLB") || 0;
    const total = nba + nfl + mlb;

    expect(nba).toBeLessThanOrEqual(0.55 + 1e-6);
    expect(nfl).toBeGreaterThanOrEqual(0.15 - 1e-6);
    expect(mlb).toBeGreaterThanOrEqual(0.15 - 1e-6);
    expect(total).toBeCloseTo(1, 6);
  });

  it("loads bot state with the live lp_transactions.transaction_type column", async () => {
    const loadBotState = __deterministicEngineTestHooks.loadBotState;
    const queryTexts: string[] = [];

    const profile = {
      userId: "bot_user_1",
      profileId: "bot_profile_1",
      botName: "Market Maker Alpha",
      role: "market_maker",
      isActive: true,
      actionProbability: 1,
      maxDailyActions: 20,
      playerCooldownHours: 8,
      maxPlayerExposurePercent: 12,
      maxSportConcentration: 0.5,
      activeHoursStart: 0,
      activeHoursEnd: 24,
      minOrderSb: 10,
      maxOrderSb: 150,
      scoutTargetCount: 8,
      scoutRotationHours: 168,
      allowedActions: ["scout_assign", "pool_create", "buy", "sell"],
      actionWeights: {
        pool_create: 35,
      },
    } as any;

    const state = await loadBotState(profile);

    expect(state).toEqual(
      expect.objectContaining({
        profile,
        balance: 10000,
        totalHoldings: 0,
        uniquePlayersHeld: 0,
        lpPositionCount: 0,
        poolsCreated: 1,
        stage: "scouting",
        scoutAssignments: [],
        maxScouts: 10,
      }),
    );

    for (const call of mocks.dbExecute.mock.calls) {
      queryTexts.push(collectSqlStrings(call[0]).join(" "));
    }

    expect(queryTexts.some((query) => /transaction_type\s*=\s*'add'/i.test(query))).toBe(true);
    expect(queryTexts.some((query) => /operation\s*=\s*'add'/i.test(query))).toBe(false);
  });
});
