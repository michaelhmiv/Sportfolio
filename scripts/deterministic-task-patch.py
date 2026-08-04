from pathlib import Path
from urllib.request import urlopen

SOURCE_URL = (
    "https://raw.githubusercontent.com/michaelhmiv/Sportfolio/"
    "4803cc9ed24fc87753066a893b8ad0652483869c/"
    "scripts/deterministic-task-patch.py"
)
source = urlopen(SOURCE_URL, timeout=30).read().decode("utf-8")
old = 'pattern = re.compile(r"const PUBLIC_TOOL_ONLY_CAPABILITY_IDS = \\[(.*?)\\];", re.S)'
new = 'pattern = re.compile(r"const PUBLIC_TOOL_ONLY_CAPABILITY_IDS = \\[(.*?)\\] as const;", re.S)'
if source.count(old) != 1:
    raise RuntimeError("Unable to locate the public tool capability regex in the pinned patch")
source = source.replace(old, new, 1)
exec(compile(source, SOURCE_URL, "exec"), {"__file__": str(Path(__file__).resolve()), "__name__": "__main__"})

ROOT = Path(__file__).resolve().parents[1]
testing_path = ROOT / "server/mcp/testing.ts"
text = testing_path.read_text()


def replace_once(value: str, before: str, after: str, label: str) -> str:
    count = value.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return value.replace(before, after, 1)


text = replace_once(
    text,
    'import type { AgentToolDefinition } from "../agent/types";\n',
    'import type { AgentToolDefinition } from "../agent/types";\n'
    'import { SportsAdapterRegistry } from "../sports/adapter-registry";\n'
    'import type { ProviderMetadata } from "../sports/contracts";\n',
    "sports fixture imports",
)

marker = '''function createIsoNow() {
  return MOCK_NOW;
}
'''
helper = marker + '''
const MOCK_SPORTS_PROVIDER: ProviderMetadata = {
  provider: "fixture",
  fetchedAt: MOCK_NOW,
  staleAfterSeconds: 60,
  isStale: false,
};

function createMockSportsRegistry() {
  const registry = new SportsAdapterRegistry();
  registry.register({
    sport: "mlb",
    async searchAthletes(query) {
      return query.toLowerCase().includes("ohtani")
        ? [
            {
              id: "mlb_660271",
              sport: "mlb",
              name: "Shohei Ohtani",
              teamId: "mlb_team_119",
              position: "DH",
              active: true,
              provider: MOCK_SPORTS_PROVIDER,
            },
          ]
        : [];
    },
    async getAthlete(id) {
      return id === "mlb_660271"
        ? {
            id,
            sport: "mlb",
            name: "Shohei Ohtani",
            teamId: "mlb_team_119",
            position: "DH",
            active: true,
            provider: MOCK_SPORTS_PROVIDER,
          }
        : null;
    },
    async getTeams() {
      return [
        {
          id: "mlb_team_119",
          sport: "mlb",
          name: "Los Angeles Dodgers",
          abbreviation: "LAD",
          provider: MOCK_SPORTS_PROVIDER,
        },
      ];
    },
    async getSchedule() {
      return [
        {
          id: "mlb_game_1",
          sport: "mlb",
          startsAt: "2026-08-04T23:10:00.000Z",
          status: "scheduled",
          homeTeamId: "mlb_team_119",
          awayTeamId: "mlb_team_144",
          provider: MOCK_SPORTS_PROVIDER,
        },
      ];
    },
    async getLiveState(gameId) {
      return {
        gameId,
        status: "in_progress",
        clock: null,
        period: "5th",
        summary: "Top 5th",
        provider: MOCK_SPORTS_PROVIDER,
      };
    },
  });
  registry.register({
    sport: "nhl",
    async getSchedule() {
      return [];
    },
    async getLiveState(gameId) {
      return {
        gameId,
        status: "scheduled",
        clock: null,
        period: null,
        summary: "Scheduled",
        provider: MOCK_SPORTS_PROVIDER,
      };
    },
  });
  registry.register({
    sport: "nascar",
    async getSchedule() {
      return [];
    },
    async getLiveState(gameId) {
      return {
        gameId,
        status: "scheduled",
        clock: null,
        period: null,
        summary: "Scheduled",
        provider: MOCK_SPORTS_PROVIDER,
      };
    },
  });
  return registry;
}
'''
text = replace_once(text, marker, helper, "sports fixture helper")
text = replace_once(
    text,
    '  const deps = {\n    storage,\n',
    '  const deps = {\n    storage,\n    sportsRegistry: createMockSportsRegistry(),\n',
    "sports fixture dependency",
)

testing_path.write_text(text)
