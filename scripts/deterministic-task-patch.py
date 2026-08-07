from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:140]!r}")
    write(path, content.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    content = read(path)
    updated, count = re.subn(pattern, lambda _: replacement, content, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex match, found {count}: {pattern[:140]!r}")
    write(path, updated)


# Shared lifecycle contract.
write(
    "server/player-lifecycle.ts",
    '''export type PlayerActivityFilter = "active" | "inactive" | "all";

export function normalizePlayerActivityFilter(value: unknown): PlayerActivityFilter | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "active" || normalized === "inactive" || normalized === "all") {
    return normalized;
  }
  return undefined;
}

export function resolvePlayerActivityFilter(input: {
  explicit?: PlayerActivityFilter;
  search?: string | null;
}): PlayerActivityFilter {
  if (input.explicit) return input.explicit;
  return input.search?.trim() ? "all" : "active";
}

export function assertPlayerScoutable(
  player: { isActive?: boolean | null } | null | undefined,
): void {
  if (!player) throw new Error("Player not found");
  if (player.isActive !== true) throw new Error("Inactive players cannot be scouted");
}
''',
)

write(
    "server/player-lifecycle.test.ts",
    '''import { describe, expect, it } from "vitest";
import {
  assertPlayerScoutable,
  normalizePlayerActivityFilter,
  resolvePlayerActivityFilter,
} from "./player-lifecycle";

describe("player lifecycle", () => {
  it("keeps normal marketplace browsing active-only", () => {
    expect(resolvePlayerActivityFilter({})).toBe("active");
  });

  it("lets explicit search find previously admitted inactive assets", () => {
    expect(resolvePlayerActivityFilter({ search: "Joe Burrow" })).toBe("all");
  });

  it("honors explicit activity filters", () => {
    expect(resolvePlayerActivityFilter({ explicit: "inactive", search: "Joe" })).toBe("inactive");
    expect(resolvePlayerActivityFilter({ explicit: "active", search: "Joe" })).toBe("active");
    expect(resolvePlayerActivityFilter({ explicit: "all" })).toBe("all");
  });

  it("rejects unsupported activity query values", () => {
    expect(normalizePlayerActivityFilter("ALL")).toBe("all");
    expect(normalizePlayerActivityFilter(" inactive ")).toBe("inactive");
    expect(normalizePlayerActivityFilter("retired")).toBeUndefined();
  });

  it("allows positive scouting only for currently active athletes", () => {
    expect(() => assertPlayerScoutable({ isActive: true })).not.toThrow();
    expect(() => assertPlayerScoutable({ isActive: false })).toThrow(
      "Inactive players cannot be scouted",
    );
    expect(() => assertPlayerScoutable(null)).toThrow("Player not found");
  });
});
''',
)

write(
    "docs/PLAYER_LIFECYCLE.md",
    '''# Player lifecycle

Sportfolio separates permanent asset identity from reversible real-world activity.

- A new player is admitted only from a current authoritative roster/feed while the athlete is active, rostered, and eligible for that sport. Historical-only, retired, and free-agent provider records are not proactively imported.
- Once admitted, the player row and canonical Sportfolio identity are permanent. Roster synchronization may set `isActive=false`, but it must never delete the player or their holdings, market, trades, price history, watchlists, scouting history, or game history.
- `isActive=true` means the athlete is currently eligible for scouting and active-sport workflows. `isActive=false` blocks new scouting and scout distributions, while the permanent asset remains directly accessible and tradeable.
- A transition to inactive atomically releases current scout assignments and closes their open scout-history intervals. Previously earned shares are untouched.
- If an athlete returns, the authoritative roster upsert reuses the same canonical player and sets `isActive=true`. Old scout assignments are not restored automatically.
- Normal marketplace browsing defaults to active athletes to avoid clutter. Explicit name search can return inactive admitted assets, and callers may request `activity=active|inactive|all`.
''',
)

# Storage imports.
replace_once(
    "server/storage.ts",
    '''import {
  holdingReservationDomain,
  loadPlayerIdentityContext,
  loadPlayerIdentityContexts,
} from "./player-identity";
''',
    '''import {
  holdingReservationDomain,
  loadPlayerIdentityContext,
  loadPlayerIdentityContexts,
} from "./player-identity";
import {
  assertPlayerScoutable,
  resolvePlayerActivityFilter,
  type PlayerActivityFilter,
} from "./player-lifecycle";
''',
)

# IStorage paginated-player contract.
replace_once(
    "server/storage.ts",
    '''  getPlayersPaginated(filters?: {
    search?: string;
    team?: string;
    position?: string;
    sport?: string;
    limit?: number;
''',
    '''  getPlayersPaginated(filters?: {
    search?: string;
    team?: string;
    position?: string;
    sport?: string;
    activity?: PlayerActivityFilter;
    limit?: number;
''',
)

# DatabaseStorage paginated-player signature and activity behavior.
replace_once(
    "server/storage.ts",
    '''  async getPlayersPaginated(filters?: {
    search?: string;
    team?: string;
    position?: string;
    sport?: string;
    limit?: number;
''',
    '''  async getPlayersPaginated(filters?: {
    search?: string;
    team?: string;
    position?: string;
    sport?: string;
    activity?: PlayerActivityFilter;
    limit?: number;
''',
)
replace_once(
    "server/storage.ts",
    '''      position,
      sport,
      limit = 50,
''',
    '''      position,
      sport,
      activity,
      limit = 50,
''',
)
replace_once(
    "server/storage.ts",
    '''    if (teamsPlayingOnDate && teamsPlayingOnDate.length > 0) {
      conditions.push(inArray(players.team, teamsPlayingOnDate));
    } // Always filter by is_active
    conditions.push(eq(players.isActive, true));
''',
    '''    if (teamsPlayingOnDate && teamsPlayingOnDate.length > 0) {
      conditions.push(inArray(players.team, teamsPlayingOnDate));
    }

    // Activity controls current sporting/scouting eligibility, not permanent asset existence.
    // Default browse remains active-only; an explicit search may resolve an inactive asset.
    const activityFilter = resolvePlayerActivityFilter({ explicit: activity, search });
    if (activityFilter === "active") conditions.push(eq(players.isActive, true));
    if (activityFilter === "inactive") conditions.push(eq(players.isActive, false));
''',
)

# A player deactivation is an atomic activity transition: keep the player asset, but
# release current scouts and close current scout-history intervals. Reactivation is a
# normal same-ID upsert/update and does not restore old assignments.
replace_once(
    "server/storage.ts",
    '''  async updatePlayer(playerId: string, updates: Partial<InsertPlayer>): Promise<void> {
    await db
      .update(players)
      .set({
        ...updates,
        lastUpdated: new Date(),
      })
      .where(eq(players.id, playerId));
  }
''',
    '''  async updatePlayer(playerId: string, updates: Partial<InsertPlayer>): Promise<void> {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ isActive: players.isActive })
        .from(players)
        .where(eq(players.id, playerId))
        .limit(1);

      await tx
        .update(players)
        .set({
          ...updates,
          lastUpdated: new Date(),
        })
        .where(eq(players.id, playerId));

      if (current?.isActive === true && updates.isActive === false) {
        const endedAt = new Date();
        await tx.delete(scoutAssignments).where(eq(scoutAssignments.playerId, playerId));
        await tx
          .update(scoutHistory)
          .set({ endedAt })
          .where(and(eq(scoutHistory.playerId, playerId), isNull(scoutHistory.endedAt)));
      }
    });
  }
''',
)

# Hard server-side scouting eligibility. Count zero remains legal so users/jobs can remove
# an assignment even after the player becomes inactive.
regex_once(
    "server/storage.ts",
    r'''(  private async assignScoutsInTransaction\(\n    tx: any,\n    userId: string,\n    playerId: string,\n    count: number,\n  \): Promise<void> \{\n)    const \[user\] = await tx\.select\(\)\.from\(users\)\.where\(eq\(users\.id, userId\)\);''',
    '''  private async assignScoutsInTransaction(
    tx: any,
    userId: string,
    playerId: string,
    count: number,
  ): Promise<void> {
    if (count > 0) {
      const [player] = await tx
        .select({ isActive: players.isActive })
        .from(players)
        .where(eq(players.id, playerId))
        .limit(1);
      assertPlayerScoutable(player);
    }

    const [user] = await tx.select().from(users).where(eq(users.id, userId));''',
)

# Defense-in-depth for existing assignments and race conditions during distribution.
replace_once(
    "server/storage.ts",
    '''    const results = await db
      .selectDistinct({ playerId: scoutAssignments.playerId })
      .from(scoutAssignments)
      .innerJoin(users, eq(scoutAssignments.userId, users.id))
      .where(gte(users.lastActiveAt, twentyFourHoursAgo));
''',
    '''    const results = await db
      .selectDistinct({ playerId: scoutAssignments.playerId })
      .from(scoutAssignments)
      .innerJoin(users, eq(scoutAssignments.userId, users.id))
      .innerJoin(players, eq(scoutAssignments.playerId, players.id))
      .where(and(gte(users.lastActiveAt, twentyFourHoursAgo), eq(players.isActive, true)));
''',
)
replace_once(
    "server/storage.ts",
    '''      if (!player) {
        throw new Error(`Player ${canonicalDistribution.playerId} not found`);
      }

      if (canonicalHolding) {
''',
    '''      if (!player) {
        throw new Error(`Player ${canonicalDistribution.playerId} not found`);
      }
      assertPlayerScoutable(player);

      if (canonicalHolding) {
''',
)
replace_once(
    "server/storage.ts",
    '''      .from(scoutAssignments)
      .innerJoin(users, eq(scoutAssignments.userId, users.id))
      .where(
        and(eq(scoutAssignments.playerId, playerId), gte(users.lastActiveAt, twentyFourHoursAgo)),
      );
''',
    '''      .from(scoutAssignments)
      .innerJoin(users, eq(scoutAssignments.userId, users.id))
      .innerJoin(players, eq(scoutAssignments.playerId, players.id))
      .where(
        and(
          eq(scoutAssignments.playerId, playerId),
          gte(users.lastActiveAt, twentyFourHoursAgo),
          eq(players.isActive, true),
        ),
      );
''',
)

# Marketplace route: activity=active|inactive|all is explicit; a normal name search defaults
# to all admitted assets, while a no-search browse remains active-only in storage.
replace_once(
    "server/routes/players.ts",
    '''} from "./players-query";
''',
    '''} from "./players-query";
import { normalizePlayerActivityFilter } from "../player-lifecycle";
''',
)
replace_once(
    "server/routes/players.ts",
    '''      const { team, position, sortBy, sortOrder, teamsPlayingOnDate, sport } = req.query;
      const rawSearch = normalizePlayersSearchQuery({
''',
    '''      const { team, position, sortBy, sortOrder, teamsPlayingOnDate, sport } = req.query;
      const activity = normalizePlayerActivityFilter(req.query.activity);
      const rawSearch = normalizePlayersSearchQuery({
''',
)
replace_once(
    "server/routes/players.ts",
    '''        position: position as string,
        sport: sport as string,
        limit: safeLimit,
''',
    '''        position: position as string,
        sport: sport as string,
        activity,
        limit: safeLimit,
''',
)

# NASCAR full-roster sync: make activity reversible using the permanent driver ID. Only
# deactivate against a complete authoritative union of all three non-empty series feeds.
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''): Promise<{ requestCount: number; recordsProcessed: number; errorCount: number }> {
''',
    '''): Promise<{
  requestCount: number;
  recordsProcessed: number;
  errorCount: number;
  activePlayerIds: string[];
}> {
''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;

  try {
''',
    '''  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;
  const activePlayerIds = new Set<string>();

  try {
''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''    console.log(`[nascar_roster_sync] Fetched ${drivers.length} drivers from ${seriesName}`);

    progressCallback?.({
''',
    '''    console.log(`[nascar_roster_sync] Fetched ${drivers.length} drivers from ${seriesName}`);
    if (drivers.length === 0) {
      throw new Error(`empty ${seriesName} driver roster; refusing authoritative deactivation`);
    }

    progressCallback?.({
''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''        await storage.upsertPlayer({
          id: createNascarPlayerId(driver.driver_id, seriesId),
          sport: NASCAR_SPORT,
''',
    '''        const playerId = createNascarPlayerId(driver.driver_id, seriesId);
        await storage.upsertPlayer({
          id: playerId,
          sport: NASCAR_SPORT,
''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''          isActive: true,
          isEligibleForVesting: true,
        });

        recordsProcessed++;
''',
    '''          isActive: true,
          isEligibleForVesting: true,
        });
        activePlayerIds.add(playerId);

        recordsProcessed++;
''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''    return { requestCount, recordsProcessed, errorCount };
  } catch (error: any) {
''',
    '''    return { requestCount, recordsProcessed, errorCount, activePlayerIds: [...activePlayerIds] };
  } catch (error: any) {
''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''    return { requestCount, recordsProcessed: 0, errorCount: errorCount + 1 };
  }
}
''',
    '''    return {
      requestCount,
      recordsProcessed: 0,
      errorCount: errorCount + 1,
      activePlayerIds: [],
    };
  }
}
''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''export async function syncNascarRoster(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[nascar_roster_sync] Starting NASCAR roster sync for all series...");

  let totalRequestCount = 0;
  let totalRecordsProcessed = 0;
  let totalErrorCount = 0;

  const seriesList: NascarSeriesId[] = [
''',
    '''export async function syncNascarRoster(progressCallback?: ProgressCallback): Promise<JobResult> {
  console.log("[nascar_roster_sync] Starting NASCAR roster sync for all series...");

  let totalRequestCount = 0;
  let totalRecordsProcessed = 0;
  let totalErrorCount = 0;
  const activePlayerIds = new Set<string>();
  let authoritative = true;

  const seriesList: NascarSeriesId[] = [
''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''    totalRequestCount += result.requestCount;
    totalRecordsProcessed += result.recordsProcessed;
    totalErrorCount += result.errorCount;
  }

  console.log(
''',
    '''    totalRequestCount += result.requestCount;
    totalRecordsProcessed += result.recordsProcessed;
    totalErrorCount += result.errorCount;
    result.activePlayerIds.forEach((playerId) => activePlayerIds.add(playerId));
    if (result.errorCount > 0 || result.activePlayerIds.length === 0) authoritative = false;
  }

  if (authoritative) {
    const existingPlayers = await storage.getPlayersBySport(NASCAR_SPORT);
    for (const player of existingPlayers) {
      if (!player.isActive || activePlayerIds.has(player.id)) continue;
      await storage.updatePlayer(player.id, {
        isActive: false,
        isEligibleForVesting: false,
      });
    }
  } else {
    console.warn(
      "[nascar_roster_sync] Non-authoritative series response; existing activity state retained",
    );
  }

  console.log(
''',
)

# NASCAR lifecycle regression tests.
write(
    "server/jobs/sync-nascar-roster.test.ts",
    '''import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  upsertPlayer: vi.fn(),
  getPlayersBySport: vi.fn(),
  updatePlayer: vi.fn(),
}));
const api = vi.hoisted(() => ({
  fetchDrivers: vi.fn(),
  fetchRaceSchedule: vi.fn(),
  fetchActiveDriversForRace: vi.fn(),
}));

vi.mock("../storage", () => ({ storage }));
vi.mock("../nascar-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../nascar-api")>();
  return {
    ...actual,
    fetchDrivers: api.fetchDrivers,
    fetchRaceSchedule: api.fetchRaceSchedule,
    fetchActiveDriversForRace: api.fetchActiveDriversForRace,
  };
});

import { syncNascarRoster } from "./sync-nascar-roster";

const driver = (id: number) => ({
  driver_id: id,
  first_name: "Driver",
  last_name: String(id),
});

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchDrivers.mockImplementation(async (seriesId: number) => [driver(seriesId * 100 + 1)]);
  storage.getPlayersBySport.mockResolvedValue([]);
  storage.upsertPlayer.mockResolvedValue(undefined);
  storage.updatePlayer.mockResolvedValue(undefined);
});

describe("syncNascarRoster player lifecycle", () => {
  it("deactivates a previously admitted missing driver without deleting the asset", async () => {
    storage.getPlayersBySport.mockResolvedValue([
      { id: "nascar_999", isActive: true },
    ]);

    const result = await syncNascarRoster();

    expect(result.errorCount).toBe(0);
    expect(storage.updatePlayer).toHaveBeenCalledWith(
      "nascar_999",
      expect.objectContaining({ isActive: false }),
    );
  });

  it("reactivates a returning driver by the same permanent driver id", async () => {
    api.fetchDrivers.mockImplementation(async (seriesId: number) =>
      seriesId === 1 ? [driver(999)] : [driver(seriesId * 100 + 1)],
    );

    await syncNascarRoster();

    expect(storage.upsertPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "nascar_999", isActive: true }),
    );
  });

  it("refuses mass deactivation when any authoritative series feed is empty", async () => {
    storage.getPlayersBySport.mockResolvedValue([{ id: "nascar_999", isActive: true }]);
    api.fetchDrivers.mockImplementation(async (seriesId: number) =>
      seriesId === 2 ? [] : [driver(seriesId * 100 + 1)],
    );

    const result = await syncNascarRoster();

    expect(result.errorCount).toBeGreaterThan(0);
    expect(storage.updatePlayer).not.toHaveBeenCalled();
  });
});
''',
)

print("persistent player lifecycle patch applied")
