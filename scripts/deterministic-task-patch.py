from pathlib import Path
from urllib.request import urlopen

SOURCE_URL = (
    "https://raw.githubusercontent.com/michaelhmiv/Sportfolio/"
    "83a226d19bc6372b9618c5481c8e59f8ad0ad3d5/"
    "scripts/deterministic-task-patch.py"
)
source = urlopen(SOURCE_URL, timeout=30).read().decode("utf-8")
old_stats = '''            const snapshots = await mapBounded(athleteIds, 3, (id) =>
              once(`${request.sport}:stats:${id}:${request.season || "current"}`, () => adapter.getStats!(id, request.season)),
            );
            const ordered = snapshots.sort((a: any, b: any) => a.entityId.localeCompare(b.entityId));'''
new_stats = '''            const snapshots = await once(
              `${request.sport}:stats:${athleteIds.join(",")}:${range?.start.toISOString() || "current"}:${range?.end.toISOString() || "current"}`,
              () => adapter.getStats!(athleteIds, range?.start, range?.end),
            );
            const ordered = (snapshots as any[]).sort((a: any, b: any) =>
              a.entityId.localeCompare(b.entityId),
            );'''
if source.count(old_stats) != 1:
    raise RuntimeError("Unable to locate stats batch block in pinned context patch")
source = source.replace(old_stats, new_stats, 1)
old_watchlist = '''                playerIds: Array.isArray(watchlist.items)
                  ? [...new Set(watchlist.items.map(String))].filter((id) => requested.size === 0 || requested.has(id)).sort()
                  : [],'''
new_watchlist = '''                playerIds: Array.isArray(watchlist.items)
                  ? Array.from(
                      new Set<string>(
                        (watchlist.items as unknown[]).map((item) => String(item)),
                      ),
                    )
                      .filter((id) => requested.size === 0 || requested.has(id))
                      .sort()
                  : [],'''
if source.count(old_watchlist) != 1:
    raise RuntimeError("Unable to locate watchlist sanitizer in pinned context patch")
source = source.replace(old_watchlist, new_watchlist, 1)
old_mock_stats = '    getStats: vi.fn(async (id) => ({ entityId: id, sport: "mlb", season: "2026", stats: { points: 1 }, provider })),'''
new_mock_stats = '''    getStats: vi.fn(async (ids) =>
      ids.map((id) => ({
        entityId: id,
        sport: "mlb",
        season: "2026",
        stats: { points: 1 },
        provider,
      })),
    ),'''
if source.count(old_mock_stats) != 1:
    raise RuntimeError("Unable to locate stats test fixture in pinned context patch")
source = source.replace(old_mock_stats, new_mock_stats, 1)
old_replace = '    value.replace({ sport: "mlb", getTeams: async () => { throw new Error("provider down"); }, getSchedule: value.get("mlb").getSchedule });'
new_replace = '    value.get("mlb").getTeams = async () => { throw new Error("provider down"); };'
if source.count(old_replace) != 1:
    raise RuntimeError("Unable to locate partial failure fixture in pinned context patch")
source = source.replace(old_replace, new_replace, 1)
old_identity = '''  const references = input.providerReferences || [];
  const resolution = await withDeadline(
    resolveProviderIdentities(references, dependencies.identityLookup),
    deadlineAt,
  );
  const resolved = references
'''
new_identity = '''  const references = input.providerReferences || [];
  const uniqueReferences = [
    ...new Map(
      references.map((reference) => [providerIdentityKey(reference), reference]),
    ).values(),
  ];
  const resolution = await withDeadline(
    resolveProviderIdentities(uniqueReferences, dependencies.identityLookup),
    deadlineAt,
  );
  const resolved = uniqueReferences
'''
if source.count(old_identity) != 1:
    raise RuntimeError("Unable to locate identity resolution block in pinned context patch")
source = source.replace(old_identity, new_identity, 1)
exec(compile(source, SOURCE_URL, "exec"), {"__file__": str(Path(__file__).resolve()), "__name__": "__main__"})
