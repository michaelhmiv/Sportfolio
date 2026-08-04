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


# Stop importing and registering the retired jobs. Historical implementation and
# database structures remain intact for rollback, but startup can no longer load
# or dispatch these capabilities.
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
    "remove agent strategy imports",
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
    pattern = rf'(name: "{re.escape(name)}",(?:(?!\n  \}},).)*?{key}: )\d+'
    return replace_regex(value, pattern, rf'\g<1>{order}', f"renumber {name} {key}")


for name, order in schedule_orders.items():
    job = replace_job_order(job, name, "scheduleOrder", order)
for name, order in manual_orders.items():
    job = replace_job_order(job, name, "manualOrder", order)
write(job_path, job)

# Remove the only lazy client entry point that produces the SMS bundle. The
# route now falls through to the normal not-found surface.
app_path = "client/src/App.tsx"
app = read(app_path)
app = replace_once(
    app,
    'const loadSmsLinkPage = () => import("@/pages/sms-link");\n',
    "",
    "remove SMS page loader",
)
app = replace_once(app, "const SmsLink = lazy(loadSmsLinkPage);\n", "", "remove SMS lazy component")
app = replace_once(
    app,
    '              <Route path="/sms/link" component={SmsLink} />\n',
    "",
    "remove SMS route",
)
write(app_path, app)

# Keep the visual-system contract aligned with the active public route set.
public_contract_path = "client/src/components/public-surfaces.contract.test.ts"
public_contract = read(public_contract_path)
public_contract = replace_once(
    public_contract,
    '  "pages/sms-link.tsx",\n',
    "",
    "remove retired SMS surface from visual contract",
)
write(public_contract_path, public_contract)

# Update scheduler fixtures and add explicit negative regression coverage.
scheduler_test_path = "server/jobs/scheduler.test.ts"
scheduler_test = read(scheduler_test_path)
scheduler_test = replace_once(
    scheduler_test,
    "  compileAllDigests: vi.fn(),\n",
    "",
    "remove digest mock handle",
)
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
    scheduler_test = replace_once(scheduler_test, line, "", f"remove scheduler fixture {line.strip()}")
scheduler_test = remove_regex(
    scheduler_test,
    r'vi\.mock\("\./compile-digest", \(\) => \(\{\n  compileAllDigests: schedulerMocks\.compileAllDigests,\n\}\)\);\n',
    "remove digest module mock",
)
scheduler_test = remove_regex(
    scheduler_test,
    r'vi\.mock\("\.\./agent/schedules", \(\) => \(\{\n  runDueUserAgentSchedules: vi\.fn\(\)\.mockResolvedValue\(defaultJobResult\),\n\}\)\);\n',
    "remove advisory module mock",
)
scheduler_test = remove_regex(
    scheduler_test,
    r'vi\.mock\("\.\./agent/strategy-runner", \(\) => \(\{\n  runDueUserAgentStrategies: vi\.fn\(\)\.mockResolvedValue\(defaultJobResult\),\n  runTriggeredUserAgentStrategies: vi\.fn\(\)\.mockResolvedValue\(defaultJobResult\),\n\}\)\);\n',
    "remove strategy module mock",
)
scheduler_test = replace_once(
    scheduler_test,
    "    schedulerMocks.compileAllDigests.mockResolvedValue({ usersProcessed: 7, errors: 2 });\n",
    "",
    "remove digest mock setup",
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
    "replace progress-forwarding test",
)
scheduler_test = replace_once(
    scheduler_test,
    "    expect(scheduler.getConfiguredJobs()).toHaveLength(33);\n    expect(schedulerMocks.schedule).toHaveBeenCalledTimes(33);\n",
    "    expect(scheduler.getConfiguredJobs()).toHaveLength(29);\n    expect(schedulerMocks.schedule).toHaveBeenCalledTimes(29);\n",
    "update configured schedule counts",
)
scheduler_test = replace_once(
    scheduler_test,
    '  it("keeps all 34 existing manual dispatch handlers executable", async () => {\n',
    '  it("keeps all 30 retained manual dispatch handlers executable", async () => {\n',
    "update executable handler test title",
)
scheduler_test = replace_once(
    scheduler_test,
    "    expect(executableJobNames).toHaveLength(34);\n",
    "    expect(executableJobNames).toHaveLength(30);\n",
    "update executable handler count",
)
scheduler_test = replace_once(
    scheduler_test,
    "    expect(names).toHaveLength(35);\n    expect(new Set(names).size).toBe(names.length);\n    expect(jobDefinitions.filter((job) => job.schedule)).toHaveLength(33);\n    expect(jobDefinitions.filter((job) => job.manualHandler)).toHaveLength(34);\n    expect(jobDefinitions.filter((job) => job.advertiseManual)).toHaveLength(34);\n",
    "    expect(names).toHaveLength(31);\n    expect(new Set(names).size).toBe(names.length);\n    expect(jobDefinitions.filter((job) => job.schedule)).toHaveLength(29);\n    expect(jobDefinitions.filter((job) => job.manualHandler)).toHaveLength(30);\n    expect(jobDefinitions.filter((job) => job.advertiseManual)).toHaveLength(30);\n",
    "update registry counts",
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
    "insert retired-job regression test",
)
write(scheduler_test_path, scheduler_test)

# Delete client-only implementation files so they cannot be reintroduced through
# an accidental route import. Historical server/database compatibility remains.
for obsolete in (
    "client/src/pages/sms-link.tsx",
    "client/src/components/sms-access-card.tsx",
    ".github/workflows/release-a-implementation.yml",
):
    path = ROOT / obsolete
    if not path.exists():
        raise RuntimeError(f"expected obsolete file to exist before deletion: {obsolete}")
    path.unlink()

# Static regression test ensures startup and build entry points stay retired.
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

print("Applied deterministic Release A cleanup patch.")
