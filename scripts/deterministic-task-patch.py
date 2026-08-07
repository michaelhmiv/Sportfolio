from pathlib import Path

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
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


# Shared lifecycle helpers and contract tests.
write(
    "server/player-lifecycle.ts",
    '''export type PlayerActivityFilter = "active" | "inactive" | "all";\n\nexport function normalizePlayerActivityFilter(value: unknown): PlayerActivityFilter | undefined {\n  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";\n  if (normalized === "active" || normalized === "inactive" || normalized === "all") {\n    return normalized;\n  }\n  return undefined;\n}\n\nexport function resolvePlayerActivityFilter(input: {\n  explicit?: PlayerActivityFilter;\n  search?: string | null;\n}): PlayerActivityFilter {\n  if (input.explicit) return input.explicit;\n  return input.search?.trim() ? "all" : "active";\n}\n\nexport function assertPlayerScoutable(\n  player: { isActive?: boolean | null } | null | undefined,\n): void {\n  if (!player) throw new Error("Player not found");\n  if (player.isActive !== true) throw new Error("Inactive players cannot be scouted");\n}\n''',
)

write(
    "server/player-lifecycle.test.ts",
    '''import { describe, expect, it } from "vitest";\nimport {\n  assertPlayerScoutable,\n  normalizePlayerActivityFilter,\n  resolvePlayerActivityFilter,\n} from "./player-lifecycle";\n\ndescribe("player lifecycle", () => {\n  it("defaults normal marketplace browsing to active players", () => {\n    expect(resolvePlayerActivityFilter({})).toBe("active");\n  });\n\n  it("includes admitted inactive players in explicit search", () => {\n    expect(resolvePlayerActivityFilter({ search: "Joe Burrow" })).toBe("all");\n  });\n\n  it("honors explicit activity filters", () => {\n    expect(resolvePlayerActivityFilter({ explicit: "inactive", search: "Joe" })).toBe("inactive");\n    expect(resolvePlayerActivityFilter({ explicit: "active", search: "Joe" })).toBe("active");\n  });\n\n  it("normalizes only supported activity query values", () => {\n    expect(normalizePlayerActivityFilter("ALL")).toBe("all");\n    expect(normalizePlayerActivityFilter(" inactive ")).toBe("inactive");\n    expect(normalizePlayerActivityFilter("retired")).toBeUndefined();\n  });\n\n  it("allows scouting only for currently active players", () => {\n    expect(() => assertPlayerScoutable({ isActive: true })).not.toThrow();\n    expect(() => assertPlayerScoutable({ isActive: false })).toThrow("Inactive players cannot be scouted");\n    expect(() => assertPlayerScoutable(null)).toThrow("Player not found");\n  });\n});\n''',
)

write(
    "docs/PLAYER_LIFECYCLE.md",
    '''# Player lifecycle\n\nSportfolio player admission is one-way while sporting activity is reversible.\n\n- A new asset is admitted only from a current authoritative roster/feed for an eligible athlete. Historical-only, retired, or free-agent provider records are not proactively imported.\n- Once admitted, the player row and canonical Sportfolio identity are permanent. Roster syncs may set `isActive=false`, but must not delete the player or their holdings, markets, trades, watchlists, price history, scouting history, or game history.\n- `isActive=true` means the athlete is currently eligible for scouting and active-sport workflows. `isActive=false` blocks new scouting and scout distributions, but the existing asset remains directly accessible and tradeable.\n- If the athlete returns, the same canonical player is reactivated with `isActive=true`; old scout assignments are not automatically restored.\n- Normal marketplace browsing defaults to active athletes to avoid clutter. Explicit name search can return previously admitted inactive athletes, and callers may request `activity=active|inactive|all`.\n''',
)

# Storage: import lifecycle helpers.
replace_once(
    "server/storage.ts",
    '''import {\n  holdingReservationDomain,\n  loadPlayerIdentityContext,\n  loadPlayerIdentityContexts,\n} from "./player-identity";\n''',
    '''import {\n  holdingReservationDomain,\n  loadPlayerIdentityContext,\n  loadPlayerIdentityContexts,\n} from "./player-identity";\nimport {\n  assertPlayerScoutable,\n  resolvePlayerActivityFilter,\n  type PlayerActivityFilter,\n} from "./player-lifecycle";\n''',
)

# Storage interface: activity filter and scout release primitive.
replace_once(
    "server/storage.ts",
    '''    sport?: string;\n    limit?: number;\n''',
    '''    sport?: string;\n    activity?: PlayerActivityFilter;\n    limit?: number;\n''',
)
replace_once(
    "server/storage.ts",
    '''  assignScouts(userId: string, playerId: string, count: number): Promise<void>;\n  getUserScoutAssignments(userId: string): Promise<(ScoutAssignment & { player: Player | null })[]>;\n''',
    '''  assignScouts(userId: string, playerId: string, count: number): Promise<void>;\n  releaseScoutsForPlayer(playerId: string): Promise<number>;\n  getUserScoutAssignments(userId: string): Promise<(ScoutAssignment & { player: Player | null })[]>;\n''',
)

# Storage implementation: marketplace activity semantics.
replace_once(
    "server/storage.ts",
    '''    sport?: string;\n    limit?: number;\n    offset?: number;\n    sortBy?:\n''',
    '''    sport?: string;\n    activity?: PlayerActivityFilter;\n    limit?: number;\n    offset?: number;\n    sortBy?:\n''',
)
replace_once(
    "server/storage.ts",
    '''      sport,\n      limit = 50,\n''',
    '''      sport,\n      activity,\n      limit = 50,\n''',
)
replace_once(
    "server/storage.ts",
    '''    if (teamsPlayingOnDate && teamsPlayingOnDate.length > 0) {\n      conditions.push(inArray(players.team, teamsPlayingOnDate));\n    } // Always filter by is_active\n    conditions.push(eq(players.isActive, true));\n''',
    '''    if (teamsPlayingOnDate && teamsPlayingOnDate.length > 0) {\n      conditions.push(inArray(players.team, teamsPlayingOnDate));\n    }\n\n    // Activity is sporting/scouting status, not asset existence. Keep normal browsing\n    // uncluttered, but allow explicit search/direct market flows to reach permanent\n    // inactive assets.\n    const activityFilter = resolvePlayerActivityFilter({ explicit: activity, search });\n    if (activityFilter === "active") conditions.push(eq(players.isActive, true));\n    if (activityFilter === "inactive") conditions.push(eq(players.isActive, false));\n''',
)

# Storage implementation: hard server-side scouting eligibility.
replace_once(
    "server/storage.ts",
    '''  ): Promise<void> {\n    const [user] = await tx.select().from(users).where(eq(users.id, userId));\n''',
    '''  ): Promise<void> {\n    if (count > 0) {\n      const [player] = await tx\n        .select({ isActive: players.isActive })\n        .from(players)\n        .where(eq(players.id, playerId))\n        .limit(1);\n      assertPlayerScoutable(player);\n    }\n\n    const [user] = await tx.select().from(users).where(eq(users.id, userId));\n''',
)

# Release all current assignments when an admitted player becomes inactive. Historical\n# scout rows are closed, never deleted.
replace_once(
    "server/storage.ts",
    '''  async assignScouts(userId: string, playerId: string, count: number): Promise<void> {\n    await db.transaction(async (tx) => {\n      await this.assignScoutsInTransaction(tx, userId, playerId, count);\n    });\n  }\n\n  async applyScoutAssignments(\n''',
    '''  async assignScouts(userId: string, playerId: string, count: number): Promise<void> {\n    await db.transaction(async (tx) => {\n      await this.assignScoutsInTransaction(tx, userId, playerId, count);\n    });\n  }\n\n  async releaseScoutsForPlayer(playerId: string): Promise<number> {\n    return db.transaction(async (tx) => {\n      const endedAt = new Date();\n      const released = await tx\n        .delete(scoutAssignments)\n        .where(eq(scoutAssignments.playerId, playerId))\n        .returning({ userId: scoutAssignments.userId });\n\n      await tx\n        .update(scoutHistory)\n        .set({ endedAt })\n        .where(\n          and(\n            eq(scoutHistory.playerId, playerId),\n            isNull(scoutHistory.endedAt),\n          ),\n        );\n\n      return released.length;\n    });\n  }\n\n  async applyScoutAssignments(\n''',
)

# Defense in depth: inactive players cannot remain in distribution selection or receive\n# a stale payout if activity flips during a job.
replace_once(
    "server/storage.ts",
    '''    const results = await db\n      .selectDistinct({ playerId: scoutAssignments.playerId })\n      .from(scoutAssignments)\n      .innerJoin(users, eq(scoutAssignments.userId, users.id))\n      .where(gte(users.lastActiveAt, twentyFourHoursAgo));\n''',
    '''    const results = await db\n      .selectDistinct({ playerId: scoutAssignments.playerId })\n      .from(scoutAssignments)\n      .innerJoin(users, eq(scoutAssignments.userId, users.id))\n      .innerJoin(players, eq(scoutAssignments.playerId, players.id))\n      .where(\n        and(gte(users.lastActiveAt, twentyFourHoursAgo), eq(players.isActive, true)),\n      );\n''',
)
replace_once(
    "server/storage.ts",
    '''      if (!player) {\n        throw new Error(`Player ${canonicalDistribution.playerId} not found`);\n      }\n\n      if (canonicalHolding) {\n''',
    '''      if (!player) {\n        throw new Error(`Player ${canonicalDistribution.playerId} not found`);\n      }\n      assertPlayerScoutable(player);\n\n      if (canonicalHolding) {\n''',
)
replace_once(
    "server/storage.ts",
    '''      .from(scoutAssignments)\n      .innerJoin(users, eq(scoutAssignments.userId, users.id))\n      .where(\n        and(eq(scoutAssignments.playerId, playerId), gte(users.lastActiveAt, twentyFourHoursAgo)),\n      );\n''',
    '''      .from(scoutAssignments)\n      .innerJoin(users, eq(scoutAssignments.userId, users.id))\n      .innerJoin(players, eq(scoutAssignments.playerId, players.id))\n      .where(\n        and(\n          eq(scoutAssignments.playerId, playerId),\n          gte(users.lastActiveAt, twentyFourHoursAgo),\n          eq(players.isActive, true),\n        ),\n      );\n''',
)

# Player route: expose validated activity query while preserving automatic search behavior.
replace_once(
    "server/routes/players.ts",
    '''} from "./players-query";\n''',
    '''} from "./players-query";\nimport { normalizePlayerActivityFilter } from "../player-lifecycle";\n''',
)
replace_once(
    "server/routes/players.ts",
    '''      const { team, position, sortBy, sortOrder, teamsPlayingOnDate, sport } = req.query;\n''',
    '''      const { team, position, sortBy, sortOrder, teamsPlayingOnDate, sport } = req.query;\n      const activity = normalizePlayerActivityFilter(req.query.activity);\n''',
)
replace_once(
    "server/routes/players.ts",
    '''        sport: sport as string,\n        limit: safeLimit,\n''',
    '''        sport: sport as string,\n        activity,\n        limit: safeLimit,\n''',
)

# Roster deactivation is reversible metadata. Release scouts, but preserve the asset.
for path in ["server/jobs/sync-mlb-roster.ts", "server/jobs/sync-nhl-roster.ts", "server/jobs/sync-nfl-roster.ts"]:
    replace_once(
        path,
        '''      await storage.updatePlayer(player.id, { isActive: false, isEligibleForVesting: false });\n      result.playersDeactivated++;\n'''
        if "nfl" in path or "nhl" in path
        else '''          await storage.updatePlayer(existingPlayer.id, {\n            isActive: false,\n            isEligibleForVesting: false,\n          });\n          result.playersDeactivated++;\n''',
        '''      await storage.updatePlayer(player.id, { isActive: false, isEligibleForVesting: false });\n      await storage.releaseScoutsForPlayer(player.id);\n      result.playersDeactivated++;\n'''
        if "nfl" in path or "nhl" in path
        else '''          await storage.updatePlayer(existingPlayer.id, {\n            isActive: false,\n            isEligibleForVesting: false,\n          });\n          await storage.releaseScoutsForPlayer(existingPlayer.id);\n          result.playersDeactivated++;\n''',
    )

# NHL tests mock the new deactivation side effect and prove the permanent-row behavior.
replace_once(
    "server/jobs/sync-nhl-jobs.test.ts",
    '''    updatePlayer: vi.fn(),\n    upsertPlayer: vi.fn(),\n''',
    '''    updatePlayer: vi.fn(),\n    releaseScoutsForPlayer: vi.fn(),\n    upsertPlayer: vi.fn(),\n''',
)
replace_once(
    "server/jobs/sync-nhl-jobs.test.ts",
    '''  it("retains last-known players for failed or empty team rosters", async () => {\n''',
    '''  it("deactivates an authoritative roster departure without deleting the asset", async () => {\n    storage.getPlayersBySport.mockResolvedValue([{ id: "nhl_9", team: "AAA", isActive: true }]);\n    nhlApi.getStandings.mockResolvedValue({ standings: [{ abbrev: "AAA" }] });\n    nhlApi.getRoster.mockResolvedValue(completeRoster(1000));\n\n    const result = await syncNhlRoster();\n\n    expect(storage.updatePlayer).toHaveBeenCalledWith(\n      "nhl_9",\n      expect.objectContaining({ isActive: false }),\n    );\n    expect(storage.releaseScoutsForPlayer).toHaveBeenCalledWith("nhl_9");\n    expect(result.playersDeactivated).toBe(1);\n  });\n\n  it("retains last-known players for failed or empty team rosters", async () => {\n''',
)

# MLB tests mock and validate scout release on deactivation.
replace_once(
    "server/jobs/sync-mlb-roster.test.ts",
    '''  updatePlayer: vi.fn(),\n  upsertPlayer: vi.fn(),\n''',
    '''  updatePlayer: vi.fn(),\n  releaseScoutsForPlayer: vi.fn(),\n  upsertPlayer: vi.fn(),\n''',
)
replace_once(
    "server/jobs/sync-mlb-roster.test.ts",
    '''  it("does not deactivate an active provider id when the update write fails", async () => {\n''',
    '''  it("keeps an admitted player permanent while deactivating roster eligibility", async () => {\n    storageMocks.getPlayersBySport.mockResolvedValue([\n      { id: "mlb_old", isActive: true },\n    ]);\n    mlbApiMocks.fetchAllPlayers.mockResolvedValue([]);\n\n    const { syncMLBRoster } = await import("./sync-mlb-roster");\n    const result = await syncMLBRoster();\n\n    expect(storageMocks.updatePlayer).toHaveBeenCalledWith(\n      "mlb_old",\n      expect.objectContaining({ isActive: false }),\n    );\n    expect(storageMocks.releaseScoutsForPlayer).toHaveBeenCalledWith("mlb_old");\n    expect(result.playersDeactivated).toBe(1);\n  });\n\n  it("does not deactivate an active provider id when the update write fails", async () => {\n''',
)

# NASCAR: full current-driver sync becomes authoritative only if every series returns a\n# non-empty successful roster. Previously admitted drivers missing from that union become\n# inactive (never deleted) and can be reactivated by the same driver ID later.
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''): Promise<{ requestCount: number; recordsProcessed: number; errorCount: number }> {\n''',
    '''): Promise<{\n  requestCount: number;\n  recordsProcessed: number;\n  errorCount: number;\n  activePlayerIds: string[];\n}> {\n''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''  let requestCount = 0;\n  let recordsProcessed = 0;\n  let errorCount = 0;\n''',
    '''  let requestCount = 0;\n  let recordsProcessed = 0;\n  let errorCount = 0;\n  const activePlayerIds = new Set<string>();\n''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''    console.log(`[nascar_roster_sync] Fetched ${drivers.length} drivers from ${seriesName}`);\n''',
    '''    console.log(`[nascar_roster_sync] Fetched ${drivers.length} drivers from ${seriesName}`);\n    if (drivers.length === 0) {\n      throw new Error(`empty ${seriesName} driver roster; refusing authoritative deactivation`);\n    }\n''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''        await storage.upsertPlayer({\n          id: createNascarPlayerId(driver.driver_id, seriesId),\n''',
    '''        const playerId = createNascarPlayerId(driver.driver_id, seriesId);\n        await storage.upsertPlayer({\n          id: playerId,\n''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''          isEligibleForVesting: true,\n        });\n\n        recordsProcessed++;\n''',
    '''          isEligibleForVesting: true,\n        });\n        activePlayerIds.add(playerId);\n\n        recordsProcessed++;\n''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''    return { requestCount, recordsProcessed, errorCount };\n''',
    '''    return { requestCount, recordsProcessed, errorCount, activePlayerIds: [...activePlayerIds] };\n''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''    return { requestCount, recordsProcessed: 0, errorCount: errorCount + 1 };\n''',
    '''    return { requestCount, recordsProcessed: 0, errorCount: errorCount + 1, activePlayerIds: [] };\n''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''  let totalRequestCount = 0;\n  let totalRecordsProcessed = 0;\n  let totalErrorCount = 0;\n''',
    '''  let totalRequestCount = 0;\n  let totalRecordsProcessed = 0;\n  let totalErrorCount = 0;\n  const activePlayerIds = new Set<string>();\n  let authoritative = true;\n''',
)
replace_once(
    "server/jobs/sync-nascar-roster.ts",
    '''    totalRequestCount += result.requestCount;\n    totalRecordsProcessed += result.recordsProcessed;\n    totalErrorCount += result.errorCount;\n  }\n\n  console.log(\n''',
    '''    totalRequestCount += result.requestCount;\n    totalRecordsProcessed += result.recordsProcessed;\n    totalErrorCount += result.errorCount;\n    result.activePlayerIds.forEach((playerId) => activePlayerIds.add(playerId));\n    if (result.errorCount > 0 || result.activePlayerIds.length === 0) authoritative = false;\n  }\n\n  if (authoritative) {\n    const existingPlayers = await storage.getPlayersBySport(NASCAR_SPORT);\n    for (const player of existingPlayers) {\n      if (!player.isActive || activePlayerIds.has(player.id)) continue;\n      await storage.updatePlayer(player.id, { isActive: false, isEligibleForVesting: false });\n      await storage.releaseScoutsForPlayer(player.id);\n    }\n  } else {\n    console.warn("[nascar_roster_sync] Non-authoritative series response; existing activity state retained");\n  }\n\n  console.log(\n''',
)

print("persistent player lifecycle patch applied")
