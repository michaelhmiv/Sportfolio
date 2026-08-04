from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding="utf-8")


def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return value.replace(old, new, 1)


def remove_regex(value: str, pattern: str, label: str) -> str:
    updated, count = re.subn(pattern, "", value, count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex match, found {count}")
    return updated


def replace_regex(value: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, value, count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex match, found {count}")
    return updated


def delete(path: str) -> None:
    target = ROOT / path
    if not target.exists():
        raise RuntimeError(f"expected obsolete file to exist before deletion: {path}")
    target.unlink()


# Remove retired scheduler imports, adapters, and definitions while preserving
# their historical storage and migrations for rollback.
job_path = "server/jobs/job-registry.ts"
job = read(job_path)
job = remove_regex(
    job,
    r'import \{ runDueUserAgentSchedules \} from "\.\./agent/schedules";\n',
    "remove advisory schedule import",
)
job = remove_regex(
    job,
    r'import \{\n  runDueUserAgentStrategies,\n  runTriggeredUserAgentStrategies,\n\} from "\.\./agent/strategy-runner";\n',
    "remove strategy imports",
)
job = remove_regex(
    job,
    r'import \{ compileAllDigests \} from "\./compile-digest";\n',
    "remove digest import",
)
job = remove_regex(
    job,
    r'\nasync function runDigest\(progressCallback\?: ProgressCallback\): Promise<JobResult> \{.*?\n\}\n',
    "remove digest adapter",
)
for retired_name in (
    "compile_digest",
    "agent_advisory_schedules",
    "agent_live_strategies",
    "agent_strategy_events",
):
    job = remove_regex(
        job,
        rf'\n  \{{\n    name: "{retired_name}",.*?\n  \}},',
        f"remove {retired_name} definition",
    )

schedule_orders = {
    "scout_distribution": 0,
    "news_fetch": 1,
    "discord_hourly_market_digest": 2,
    "discord_news_post": 3,
    "bot_engine": 4,
    "lock_boost_shares": 5,
    "snapshot_share_payouts": 6,
    "settle_boosts": 7,
    "settle_share_payouts": 8,
    "settle_community_boosts": 9,
    "notification_signals": 10,
    "cleanup_job_logs": 11,
    "prune_price_history": 12,
    "api_health_check": 13,
    "update_collections": 14,
    "check_milestones": 15,
    "refresh_player_metrics": 16,
    "refresh_player_volume_24h": 17,
}
manual_orders = {
    "stats_sync_live": 0,
    "backfill_market_snapshots": 1,
    "scout_distribution": 2,
    "news_fetch": 3,
    "discord_hourly_market_digest": 4,
    "discord_news_post": 5,
    "lock_boost_shares": 6,
    "snapshot_share_payouts": 7,
    "settle_boosts": 8,
    "settle_share_payouts": 9,
    "settle_community_boosts": 10,
    "notification_signals": 11,
    "cleanup_job_logs": 12,
    "prune_price_history": 13,
    "update_collections": 14,
    "check_milestones": 15,
    "refresh_player_metrics": 16,
    "refresh_player_volume_24h": 17,
    "bot_engine": 18,
    "api_health_check": 19,
    "mlb_schedule_sync": 20,
    "mlb_stats_sync": 21,
    "mlb_roster_sync": 22,
    "nhl_schedule_sync": 23,
    "nhl_live_stats_sync": 24,
    "nhl_roster_sync": 25,
    "nascar_roster_sync": 26,
    "nascar_schedule_sync": 27,
    "nascar_stats_sync": 28,
    "nascar_live_sync": 29,
}


def replace_job_order(value: str, name: str, key: str, order: int) -> str:
    return replace_regex(
        value,
        rf'(name: "{re.escape(name)}",(?:(?!\n  \}},).)*?{key}: )\d+',
        rf'\g<1>{order}',
        f"renumber {name} {key}",
    )


for name, order in schedule_orders.items():
    job = replace_job_order(job, name, "scheduleOrder", order)
for name, order in manual_orders.items():
    job = replace_job_order(job, name, "manualOrder", order)
write(job_path, job)

# Remove the SMS client entry point and route so Vite cannot emit the retired
# lazy bundle and requests fall through to the standard not-found surface.
app_path = "client/src/App.tsx"
app = read(app_path)
app = replace_once(app, 'const loadSmsLinkPage = () => import("@/pages/sms-link");\n', "", "SMS loader")
app = replace_once(app, "const SmsLink = lazy(loadSmsLinkPage);\n", "", "SMS lazy component")
app = replace_once(app, '              <Route path="/sms/link" component={SmsLink} />\n', "", "SMS route")
write(app_path, app)

public_contract_path = "client/src/components/public-surfaces.contract.test.ts"
public_contract = read(public_contract_path)
public_contract = replace_once(public_contract, '  "pages/sms-link.tsx",\n', "", "SMS visual contract")
write(public_contract_path, public_contract)

# Align scheduler fixtures with the retained 31-definition/30-handler registry.
scheduler_test_path = "server/jobs/scheduler.test.ts"
scheduler_test = read(scheduler_test_path)
scheduler_test = replace_once(scheduler_test, "  compileAllDigests: vi.fn(),\n", "", "digest mock handle")
for line in (
    '  compile_digest: "0 6 * * *",\n',
    '  agent_advisory_schedules: "*/15 * * * *",\n',
    '  agent_live_strategies: "*/15 * * * *",\n',
    '  agent_strategy_events: "*/10 * * * *",\n',
    '  "compile_digest",\n',
    '  "agent_advisory_schedules",\n',
    '  "agent_live_strategies",\n',
    '  "agent_strategy_events",\n',
):
    scheduler_test = replace_once(scheduler_test, line, "", f"scheduler fixture {line.strip()}")
scheduler_test = remove_regex(
    scheduler_test,
    r'vi\.mock\("\./compile-digest", \(\) => \(\{\n  compileAllDigests: schedulerMocks\.compileAllDigests,\n\}\)\);\n',
    "digest module mock",
)
scheduler_test = remove_regex(
    scheduler_test,
    r'vi\.mock\("\.\./agent/schedules", \(\) => \(\{\n  runDueUserAgentSchedules: vi\.fn\(\)\.mockResolvedValue\(defaultJobResult\),\n\}\)\);\n',
    "advisory module mock",
)
scheduler_test = remove_regex(
    scheduler_test,
    r'vi\.mock\("\.\./agent/strategy-runner", \(\) => \(\{\n  runDueUserAgentStrategies: vi\.fn\(\)\.mockResolvedValue\(defaultJobResult\),\n  runTriggeredUserAgentStrategies: vi\.fn\(\)\.mockResolvedValue\(defaultJobResult\),\n\}\)\);\n',
    "strategy module mock",
)
scheduler_test = replace_once(
    scheduler_test,
    "    schedulerMocks.compileAllDigests.mockResolvedValue({ usersProcessed: 7, errors: 2 });\n",
    "",
    "digest setup",
)
scheduler_test = replace_regex(
    scheduler_test,
    r'  it\("preserves progress forwarding, suppression, and news compatibility fields", async \(\) => \{.*?\n  \}\);\n\n(?=  it\("preserves custom manual result adapters)',
    '''  it("preserves progress forwarding, suppression, and news compatibility fields", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();
    const progress = vi.fn();

    const newsResult = await scheduler.triggerJob("news_fetch", progress);
    await scheduler.triggerJob("nascar_stats_sync", progress);

    expect(schedulerMocks.fetchNews).toHaveBeenCalledWith(progress);
    expect(schedulerMocks.syncNascarStats).toHaveBeenCalledWith();
    expect(newsResult).toMatchObject({
      requestCount: 1,
      recordsProcessed: 4,
      errorCount: 1,
      stories: [{ id: "story-1" }],
      error: "partial source failure",
    });
  });

''',
    "progress forwarding test",
)
scheduler_test = replace_once(
    scheduler_test,
    "    expect(scheduler.getConfiguredJobs()).toHaveLength(33);\n    expect(schedulerMocks.schedule).toHaveBeenCalledTimes(33);\n",
    "    expect(scheduler.getConfiguredJobs()).toHaveLength(29);\n    expect(schedulerMocks.schedule).toHaveBeenCalledTimes(29);\n",
    "configured schedule counts",
)
scheduler_test = replace_once(
    scheduler_test,
    '  it("keeps all 34 existing manual dispatch handlers executable", async () => {\n',
    '  it("keeps all 30 retained manual dispatch handlers executable", async () => {\n',
    "manual handler title",
)
scheduler_test = replace_once(scheduler_test, "    expect(executableJobNames).toHaveLength(34);\n", "    expect(executableJobNames).toHaveLength(30);\n", "manual handler count")
scheduler_test = replace_once(
    scheduler_test,
    "    expect(names).toHaveLength(35);\n    expect(new Set(names).size).toBe(names.length);\n    expect(jobDefinitions.filter((job) => job.schedule)).toHaveLength(33);\n    expect(jobDefinitions.filter((job) => job.manualHandler)).toHaveLength(34);\n    expect(jobDefinitions.filter((job) => job.advertiseManual)).toHaveLength(34);\n",
    "    expect(names).toHaveLength(31);\n    expect(new Set(names).size).toBe(names.length);\n    expect(jobDefinitions.filter((job) => job.schedule)).toHaveLength(29);\n    expect(jobDefinitions.filter((job) => job.manualHandler)).toHaveLength(30);\n    expect(jobDefinitions.filter((job) => job.advertiseManual)).toHaveLength(30);\n",
    "registry counts",
)
retired_test = '''
  it("does not advertise, configure, or dispatch retired agent and digest jobs", async () => {
    const { JobScheduler } = await import("./scheduler");
    const scheduler = new JobScheduler();
    const retired = [
      "compile_digest",
      "agent_advisory_schedules",
      "agent_live_strategies",
      "agent_strategy_events",
    ];

    expect(scheduler.getAvailableManualJobNames()).not.toEqual(expect.arrayContaining(retired));
    expect(scheduler.getConfiguredJobNames()).not.toEqual(expect.arrayContaining(retired));
    for (const jobName of retired) {
      await expect(scheduler.triggerJob(jobName)).rejects.toThrow(`Unknown job: ${jobName}`);
    }
  });

'''
scheduler_test = replace_once(
    scheduler_test,
    '  it("preserves the advertised backfill job as an unknown manual trigger", async () => {\n',
    retired_test + '  it("preserves the advertised backfill job as an unknown manual trigger", async () => {\n',
    "retired job regression",
)
write(scheduler_test_path, scheduler_test)

# Validate the final migration state, including the later intentional removal of
# collection XP points and its check constraint.
collection_contract_path = "server/collections/domain-schema.contract.test.ts"
collection_contract = read(collection_contract_path)
collection_contract = replace_once(
    collection_contract,
    'const migrationPath = resolve(repositoryRoot, "migrations/0049_collections_domain_v2.sql");\n',
    'const migrationPath = resolve(repositoryRoot, "migrations/0049_collections_domain_v2.sql");\nconst pointsRemovalPath = resolve(repositoryRoot, "migrations/0052_drop_collection_xp_points.sql");\n',
    "collection follow-up migration path",
)
collection_contract = replace_once(
    collection_contract,
    '''    const migrationChecks = Array.from(
      migration.matchAll(/\\bCONSTRAINT\\s+([a-z0-9_]+_check)\\b/g),
      (match) => match[1],
    ).sort();
''',
    '''    const droppedChecks = new Set(
      Array.from(
        readFileSync(pointsRemovalPath, "utf8").matchAll(
          /\\bDROP CONSTRAINT IF EXISTS\\s+([a-z0-9_]+_check)\\b/g,
        ),
        (match) => match[1],
      ),
    );
    const migrationChecks = Array.from(
      migration.matchAll(/\\bCONSTRAINT\\s+([a-z0-9_]+_check)\\b/g),
      (match) => match[1],
    )
      .filter((name) => !droppedChecks.has(name))
      .sort();
''',
    "collection final constraint set",
)
write(collection_contract_path, collection_contract)

# Replace stale pre-Release-A MCP expectations with explicit internal-only raw
# provider denial contracts while continuing to exercise retained prompts and resources.
mcp_test_path = "server/mcp/mcp-server.test.ts"
mcp_test = read(mcp_test_path)
mcp_test = replace_once(mcp_test, "  executeResolvedPublicTool,\n", "", "unused resolved executor import")
mcp_test = replace_once(mcp_test, "  resolvePublicCapabilityCatalog,\n", "", "unused catalog resolver import")
mcp_test = replace_once(
    mcp_test,
    'import { createMockPublicMcpDependencies, startMockMcpHttpServer } from "./testing";\n',
    'import { startMockMcpHttpServer } from "./testing";\n',
    "testing import",
)
mcp_test = replace_once(mcp_test, '        name: "review_idle_cash",\n', '        name: "find_boost_candidates",\n', "retained prompt selection")
mcp_test = replace_once(
    mcp_test,
    '''        expect.arrayContaining([
          "review_setup",
          "review_idle_cash",
          "find_boost_candidates",
          "stage_trade",
        ]),
''',
    '''        expect.arrayContaining(["find_boost_candidates", "stage_trade"]),
''',
    "retained prompt expectations",
)
mcp_test = replace_once(
    mcp_test,
    '      expect(resources.resources.map((entry) => entry.uri)).toEqual(\n',
    '      expect(prompts.prompts.map((entry) => entry.name)).not.toEqual(\n        expect.arrayContaining(["review_setup", "review_idle_cash"]),\n      );\n      expect(resources.resources.map((entry) => entry.uri)).toEqual(\n',
    "retired prompt exclusion",
)
replacement_raw_test = '''
  it("keeps raw MLB MCP tools internal-only across public protocol surfaces", async () => {
    const server = await startMockMcpHttpServer({
      mlbTools: {
        toolCatalog: [
          {
            toolName: "mlb_mcp__get_schedule",
            category: "read",
            description: "Get the MLB schedule.",
            whenToUse: ["Use when the caller wants the slate."],
            whenNotToUse: [],
            examplePrompts: ["who plays today?"],
            requiresConfirmation: false,
            riskLevel: "low",
            resultShapeHint: "dates[].games[]",
            presentationProfile: "schedule",
            primaryEntityType: "game",
            preferredColumns: ["matchup", "status"],
            inputSchema: {
              type: "object",
              properties: { date: { type: "string" } },
              required: ["date"],
            },
          },
        ],
        toolResults: {},
      },
    });
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);
      const rawToolName = "mlb_mcp__get_schedule";
      const tools = await openClient.client.listTools();
      const capabilities = await openClient.client.readResource({
        uri: "sportfolio://capabilities",
      });
      const actionSurface = await openClient.client.readResource({
        uri: "sportfolio://action-surface",
      });
      const toolCatalog = await openClient.client.readResource({
        uri: "sportfolio://tool-catalog",
      });
      const result = await openClient.client.callTool({
        name: rawToolName,
        arguments: { date: "2026-03-28" },
      });

      expect(tools.tools.map((entry) => entry.name)).not.toContain(rawToolName);
      expect(result.isError).toBe(true);

      const capabilityPayload = JSON.parse(String(capabilities.contents[0]?.text)) as {
        included: Array<Record<string, unknown>>;
        dynamicSources: Array<Record<string, unknown>>;
      };
      expect(capabilityPayload.included.some((entry) => entry.capabilityId === rawToolName)).toBe(
        false,
      );
      expect(capabilityPayload.dynamicSources[0]).toMatchObject({
        provider: "internal_mlb_mcp",
        available: true,
        toolCount: 0,
      });

      const actionPayload = JSON.parse(String(actionSurface.contents[0]?.text)) as {
        tools: Array<Record<string, unknown>>;
      };
      const catalogPayload = JSON.parse(String(toolCatalog.contents[0]?.text)) as {
        tools: Array<Record<string, unknown>>;
      };
      expect(actionPayload.tools.some((entry) => entry.name === rawToolName)).toBe(false);
      expect(catalogPayload.tools.some((entry) => entry.name === rawToolName)).toBe(false);
    } finally {
      await closeClient(openClient);
      await server.close();
    }
  });

  it("keeps internal MLB discovery at zero public tools even when provider tools exist", async () => {
    const server = await startMockMcpHttpServer({
      mlbTools: {
        toolCatalog: [
          {
            toolName: "mlb_mcp__get_schedule",
            category: "read",
            description: "Get the MLB schedule.",
            whenToUse: [],
            whenNotToUse: [],
            examplePrompts: [],
            requiresConfirmation: false,
            riskLevel: "low",
            resultShapeHint: "dates[].games[]",
            presentationProfile: "schedule",
            primaryEntityType: "game",
            preferredColumns: [],
            inputSchema: { type: "object", properties: {} },
          },
        ],
        toolResults: {},
      },
    });
    let openClient: OpenClient | null = null;

    try {
      openClient = await connectClient(server.url, server.authToken);
      const initialNames = (await openClient.client.listTools()).tools.map((entry) => entry.name);
      expect(initialNames.some((name) => name.startsWith("mlb_mcp__"))).toBe(false);

      const capabilities = await openClient.client.readResource({
        uri: "sportfolio://capabilities",
      });
      const payload = JSON.parse(String(capabilities.contents[0]?.text)) as {
        dynamicSources: Array<Record<string, unknown>>;
      };
      expect(payload.dynamicSources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ provider: "internal_mlb_mcp", toolCount: 0 }),
        ]),
      );
    } finally {
      await closeClient(openClient);
      await server.close();
    }
  });

'''
mcp_test = replace_regex(
    mcp_test,
    r'\n  it\("lists and executes authenticated MLB MCP tools through the public MCP surface",.*?\n  it\("stages and confirms a scout assignment through the public MCP surface",',
    replacement_raw_test + '  it("stages and confirms a scout assignment through the public MCP surface",',
    "raw MLB public tests",
)
write(mcp_test_path, mcp_test)

# Convert intentional collection-family icon accents to the design system's
# semantic tokens so the public profile contract remains strict.
profile_path = "client/src/pages/user-profile.tsx"
profile = read(profile_path)
for old, new in (
    ("text-emerald-500", "text-status-success"),
    ("text-amber-500", "text-status-warning"),
    ("text-yellow-500", "text-premium"),
    ("text-blue-500", "text-status-info"),
    ("text-purple-500", "text-premium"),
    ("text-pink-500", "text-premium"),
):
    profile = replace_once(profile, old, new, f"semantic profile color {old}")
write(profile_path, profile)

for obsolete in (
    "client/src/pages/sms-link.tsx",
    "client/src/components/sms-access-card.tsx",
    ".github/workflows/release-a-implementation.yml",
):
    delete(obsolete)

contract_path = ROOT / "server/jobs/retired-capabilities.contract.test.ts"
contract_path.write_text(
    '''import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
const retired = [
  "compile_digest",
  "agent_advisory_schedules",
  "agent_live_strategies",
  "agent_strategy_events",
] as const;

describe("retired capability registration contract", () => {
  it("keeps retired jobs out of the canonical scheduler registry", () => {
    const registry = source("server/jobs/job-registry.ts");
    for (const name of retired) expect(registry).not.toContain(`name: "${name}"`);
    expect(registry).not.toContain("../agent/schedules");
    expect(registry).not.toContain("../agent/strategy-runner");
    expect(registry).not.toContain("./compile-digest");
  });

  it("keeps the SMS client route and lazy bundle entry point removed", () => {
    const app = source("client/src/App.tsx");
    expect(app).not.toContain("loadSmsLinkPage");
    expect(app).not.toContain("/sms/link");
    expect(existsSync(resolve(root, "client/src/pages/sms-link.tsx"))).toBe(false);
    expect(existsSync(resolve(root, "client/src/components/sms-access-card.tsx"))).toBe(false);
  });

  it("removes the one-shot Release A workflow", () => {
    expect(existsSync(resolve(root, ".github/workflows/release-a-implementation.yml"))).toBe(false);
  });
});
''',
    encoding="utf-8",
)

notes = ROOT / "docs/implementation/unified-sports-release-a-cleanup.md"
notes.write_text(
    '''# Unified Sports Release A Cleanup

This cleanup removes active registration and client entry points for the retired agent advisory, strategy, generated-digest, and SMS-link capabilities.

## Removed from runtime

- `compile_digest`
- `agent_advisory_schedules`
- `agent_live_strategies`
- `agent_strategy_events`
- the `/sms/link` client route and its lazy chunk entry point
- obsolete SMS client implementation files
- the one-shot Release A implementation workflow

## Preserved for rollback and migration safety

Database tables, historical records, migrations, environment-variable compatibility, the internal MLB compatibility client, the standalone `mlb-mcp` service, and all retained market, portfolio, scouting, boost, collection, watchlist, liquidity, account, OAuth, staged-action, and MCP Apps UI capabilities are unchanged.

A revert of the cleanup merge restores the active registrations without requiring data restoration.
''',
    encoding="utf-8",
)

print("Applied deterministic Release A cleanup and current-contract alignment patch.")
