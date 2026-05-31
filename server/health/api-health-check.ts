import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { observeApiHealthCheckRun } from "../observability/metrics";

export type ApiHealthStatus = "success" | "degraded" | "failed";

type HealthCheckCategory = "dependency" | "jobs" | "route";

type RouteTarget = {
  id: string;
  label: string;
  path: string;
  expectedStatus: number;
  maxLatencyMs: number;
  requireJson?: boolean;
  validateJson?: (value: any) => boolean;
};

type CriticalJobTarget = {
  name: string;
  maxAgeMs: number;
  requiredEnv?: string;
};

type HealthCheckOutcome = {
  status: ApiHealthStatus;
  details: string;
  expectedStatus?: number;
  actualStatus?: number | null;
};

export type ApiHealthCheckResult = {
  id: string;
  category: HealthCheckCategory;
  label: string;
  status: ApiHealthStatus;
  details: string;
  durationMs: number;
  checkedAt: string;
  path?: string;
  expectedStatus?: number;
  actualStatus?: number | null;
};

export type ApiHealthSummary = {
  total: number;
  success: number;
  degraded: number;
  failed: number;
  routeChecks: number;
};

export type ApiHealthReport = {
  runId: string;
  status: ApiHealthStatus;
  checkedAt: string;
  durationMs: number;
  baseUrl: string;
  reason: string;
  summary: ApiHealthSummary;
  checks: ApiHealthCheckResult[];
};

function parseEnvNumber(
  rawValue: string | undefined,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number {
  if (!rawValue || !rawValue.trim()) return fallback;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;

  let value = parsed;
  if (typeof options.min === "number") value = Math.max(options.min, value);
  if (typeof options.max === "number") value = Math.min(options.max, value);
  return value;
}

const DEFAULT_TIMEOUT_MS = parseEnvNumber(process.env.API_HEALTH_CHECK_TIMEOUT_MS, 6000, {
  min: 1000,
});
const DEFAULT_DB_WARN_MS = parseEnvNumber(process.env.API_HEALTH_DB_WARN_MS, 600, {
  min: 100,
});
const DEFAULT_STALE_THRESHOLD_HOURS = parseEnvNumber(
  process.env.API_HEALTH_STALE_THRESHOLD_HOURS,
  30,
  { min: 6 },
);
const STALE_THRESHOLD_MS = DEFAULT_STALE_THRESHOLD_HOURS * 60 * 60 * 1000;
const MAX_REPORT_HISTORY = 20;

const ROUTE_TARGETS: RouteTarget[] = [
  {
    id: "api_health",
    label: "Health endpoint",
    path: "/api/health",
    expectedStatus: 200,
    maxLatencyMs: 1000,
    requireJson: true,
    validateJson: (value) => value && typeof value.status === "string",
  },
  {
    id: "api_dashboard",
    label: "Dashboard payload",
    path: "/api/dashboard",
    expectedStatus: 200,
    maxLatencyMs: 2500,
    requireJson: true,
  },
  {
    id: "api_games_insights",
    label: "Games insights (NBA)",
    path: "/api/games/insights?sport=NBA",
    expectedStatus: 200,
    maxLatencyMs: 3500,
    requireJson: true,
    validateJson: (value) => value && Array.isArray(value.games),
  },
  {
    id: "api_races_insights",
    label: "Race insights (NASCAR)",
    path: "/api/races/insights",
    expectedStatus: 200,
    maxLatencyMs: 3500,
    requireJson: true,
    validateJson: (value) => value && Array.isArray(value.races),
  },
  {
    id: "api_market_scanners",
    label: "Market scanners (NBA)",
    path: "/api/market/scanners?sport=NBA",
    expectedStatus: 200,
    maxLatencyMs: 3500,
  },
  {
    id: "api_players_list",
    label: "Players list (NBA)",
    path: "/api/players?sport=NBA&limit=1&offset=0&sortBy=volume&sortOrder=desc",
    expectedStatus: 200,
    maxLatencyMs: 3500,
  },
];

const CRITICAL_JOBS: CriticalJobTarget[] = [
  { name: "scout_distribution", maxAgeMs: 2 * 60 * 60 * 1000 },
  { name: "news_fetch", maxAgeMs: 2 * 60 * 60 * 1000 },
  { name: "lock_boost_shares", maxAgeMs: 20 * 60 * 1000 },
  { name: "snapshot_share_payouts", maxAgeMs: 20 * 60 * 1000 },
  { name: "settle_boosts", maxAgeMs: 30 * 60 * 1000 },
  { name: "stats_sync_live", maxAgeMs: 20 * 60 * 1000, requiredEnv: "BALLDONTLIE_API_KEY" },
  { name: "schedule_sync", maxAgeMs: 2 * 60 * 60 * 1000, requiredEnv: "BALLDONTLIE_API_KEY" },
  { name: "nascar_live_sync", maxAgeMs: 30 * 60 * 1000 },
  { name: "nascar_stats_sync", maxAgeMs: 2 * 60 * 60 * 1000 },
];

let latestApiHealthReport: ApiHealthReport | null = null;
const apiHealthReportHistory: ApiHealthReport[] = [];

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function resolveBaseUrl(override?: string): string {
  if (override && override.trim()) return normalizeBaseUrl(override.trim());
  if (process.env.API_HEALTH_CHECK_BASE_URL?.trim()) {
    return normalizeBaseUrl(process.env.API_HEALTH_CHECK_BASE_URL.trim());
  }
  const port = process.env.PORT || "5000";
  return `http://127.0.0.1:${port}`;
}

function summarizeStatuses(
  checks: Pick<ApiHealthCheckResult, "status" | "category">[],
): ApiHealthSummary {
  const summary: ApiHealthSummary = {
    total: checks.length,
    success: 0,
    degraded: 0,
    failed: 0,
    routeChecks: checks.filter((c) => c.category === "route").length,
  };

  for (const check of checks) {
    if (check.status === "success") summary.success += 1;
    if (check.status === "degraded") summary.degraded += 1;
    if (check.status === "failed") summary.failed += 1;
  }

  return summary;
}

function summarizeOverallStatus(summary: ApiHealthSummary): ApiHealthStatus {
  if (summary.failed > 0) return "failed";
  if (summary.degraded > 0) return "degraded";
  return "success";
}

function trackReport(report: ApiHealthReport) {
  latestApiHealthReport = report;
  apiHealthReportHistory.unshift(report);
  if (apiHealthReportHistory.length > MAX_REPORT_HISTORY) {
    apiHealthReportHistory.splice(MAX_REPORT_HISTORY);
  }
}

function formatAgeMinutes(ageMs: number): string {
  return `${Math.max(0, Math.round(ageMs / 60000))}m`;
}

async function runCheck(args: {
  id: string;
  category: HealthCheckCategory;
  label: string;
  path?: string;
  execute: () => Promise<HealthCheckOutcome>;
}): Promise<ApiHealthCheckResult> {
  const started = performance.now();
  const checkedAt = new Date().toISOString();

  try {
    const outcome = await args.execute();
    return {
      id: args.id,
      category: args.category,
      label: args.label,
      status: outcome.status,
      details: outcome.details,
      durationMs: Math.round(performance.now() - started),
      checkedAt,
      path: args.path,
      expectedStatus: outcome.expectedStatus,
      actualStatus: outcome.actualStatus,
    };
  } catch (error: any) {
    return {
      id: args.id,
      category: args.category,
      label: args.label,
      status: "failed",
      details: error?.message || "Unknown health-check failure",
      durationMs: Math.round(performance.now() - started),
      checkedAt,
      path: args.path,
    };
  }
}

async function checkDatabase(): Promise<ApiHealthCheckResult> {
  return runCheck({
    id: "db_ping",
    category: "dependency",
    label: "Database ping",
    execute: async () => {
      const started = performance.now();
      await db.execute(sql`SELECT 1`);
      const latencyMs = Math.round(performance.now() - started);
      if (latencyMs > DEFAULT_DB_WARN_MS) {
        return {
          status: "degraded",
          details: `DB responded in ${latencyMs}ms (warn > ${DEFAULT_DB_WARN_MS}ms)`,
        };
      }
      return { status: "success", details: `DB responded in ${latencyMs}ms` };
    },
  });
}

function getCriticalJobs(): CriticalJobTarget[] {
  return CRITICAL_JOBS.filter((job) => !job.requiredEnv || !!process.env[job.requiredEnv]);
}

async function checkCriticalJobs(): Promise<ApiHealthCheckResult> {
  return runCheck({
    id: "critical_jobs",
    category: "jobs",
    label: "Critical scheduler jobs",
    execute: async () => {
      const criticalJobs = getCriticalJobs();
      if (criticalJobs.length === 0) {
        return { status: "success", details: "No critical jobs configured for this environment" };
      }

      const latestLogs = await storage.getLatestJobLogPerType(criticalJobs.map((job) => job.name));
      const nowMs = Date.now();
      const uptimeMs = process.uptime() * 1000;

      const missing: string[] = [];
      const degraded: string[] = [];
      const failed: string[] = [];

      for (const target of criticalJobs) {
        const log = latestLogs.get(target.name);
        if (!log) {
          if (uptimeMs > Math.max(target.maxAgeMs * 2, 6 * 60 * 60 * 1000)) {
            failed.push(`${target.name}: no recorded run`);
          } else {
            degraded.push(`${target.name}: waiting for first run`);
          }
          continue;
        }

        const referenceTimestamp = log.finishedAt || log.startedAt || log.scheduledFor;
        const ageMs = nowMs - new Date(referenceTimestamp).getTime();
        const age = formatAgeMinutes(ageMs);

        if (log.status === "failed") {
          failed.push(`${target.name}: failed (${age} ago)`);
          continue;
        }

        if (log.status === "degraded") {
          degraded.push(`${target.name}: degraded (${age} ago)`);
        }

        if (ageMs > target.maxAgeMs * 2) {
          failed.push(`${target.name}: stale (${age})`);
        } else if (ageMs > target.maxAgeMs) {
          degraded.push(`${target.name}: old (${age})`);
        }
      }

      const issues = [...missing, ...failed, ...degraded];
      if (failed.length > 0) {
        const preview = issues.slice(0, 4).join("; ");
        const suffix = issues.length > 4 ? ` (+${issues.length - 4} more)` : "";
        return { status: "failed", details: `${preview}${suffix}` };
      }

      if (degraded.length > 0 || missing.length > 0) {
        const preview = issues.slice(0, 4).join("; ");
        const suffix = issues.length > 4 ? ` (+${issues.length - 4} more)` : "";
        return { status: "degraded", details: `${preview}${suffix}` };
      }

      return { status: "success", details: `${criticalJobs.length} critical jobs healthy` };
    },
  });
}

async function checkRouteTarget(
  baseUrl: string,
  target: RouteTarget,
): Promise<ApiHealthCheckResult> {
  return runCheck({
    id: target.id,
    category: "route",
    label: target.label,
    path: target.path,
    execute: async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const started = performance.now();

      try {
        const response = await fetch(`${baseUrl}${target.path}`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });

        const durationMs = Math.round(performance.now() - started);
        if (response.status !== target.expectedStatus) {
          return {
            status: "failed",
            details: `Unexpected status ${response.status} (expected ${target.expectedStatus})`,
            expectedStatus: target.expectedStatus,
            actualStatus: response.status,
          };
        }

        if (target.requireJson) {
          let json: any;
          try {
            json = await response.json();
          } catch {
            return {
              status: "failed",
              details: "Expected JSON response but failed to parse body",
              expectedStatus: target.expectedStatus,
              actualStatus: response.status,
            };
          }

          if (target.validateJson && !target.validateJson(json)) {
            return {
              status: "degraded",
              details: "Response shape check failed",
              expectedStatus: target.expectedStatus,
              actualStatus: response.status,
            };
          }
        } else {
          await response.arrayBuffer();
        }

        if (durationMs > target.maxLatencyMs) {
          return {
            status: "degraded",
            details: `Responded in ${durationMs}ms (warn > ${target.maxLatencyMs}ms)`,
            expectedStatus: target.expectedStatus,
            actualStatus: response.status,
          };
        }

        return {
          status: "success",
          details: `Responded in ${durationMs}ms`,
          expectedStatus: target.expectedStatus,
          actualStatus: response.status,
        };
      } catch (error: any) {
        const detail =
          error?.name === "AbortError"
            ? `Timed out after ${DEFAULT_TIMEOUT_MS}ms`
            : error?.message || "Route check failed";
        return { status: "failed", details: detail, expectedStatus: target.expectedStatus };
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

async function checkNascarLiveStatsRoute(baseUrl: string): Promise<ApiHealthCheckResult> {
  return runCheck({
    id: "api_nascar_live_stats",
    category: "route",
    label: "NASCAR live stats route",
    execute: async () => {
      const rows: any = await db.execute(sql`
        SELECT game_id
        FROM daily_games
        WHERE sport = 'NASCAR'
          AND start_time >= NOW() - INTERVAL '30 days'
          AND start_time <= NOW() + INTERVAL '7 days'
        ORDER BY
          CASE
            WHEN status = 'inprogress' THEN 0
            WHEN status = 'scheduled' THEN 1
            ELSE 2
          END,
          ABS(EXTRACT(EPOCH FROM (start_time - NOW())))
        LIMIT 1
      `);
      const gameId = rows?.rows?.[0]?.game_id;
      if (!gameId) {
        return {
          status: "success",
          details: "No recent/current NASCAR race available for live-stats route check",
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      const started = performance.now();

      try {
        const response = await fetch(
          `${baseUrl}/api/games/${encodeURIComponent(gameId)}/live-stats`,
          {
            headers: { accept: "application/json" },
            signal: controller.signal,
          },
        );
        const durationMs = Math.round(performance.now() - started);
        if (response.status !== 200) {
          return {
            status: "failed",
            details: `Unexpected status ${response.status} for ${gameId}`,
            expectedStatus: 200,
            actualStatus: response.status,
          };
        }

        let json: any;
        try {
          json = await response.json();
        } catch {
          return {
            status: "failed",
            details: `Expected JSON for ${gameId} but failed to parse body`,
            expectedStatus: 200,
            actualStatus: response.status,
          };
        }

        if (!json || json.gameId !== gameId || !Array.isArray(json.awayPlayers)) {
          return {
            status: "degraded",
            details: `NASCAR live-stats response shape check failed for ${gameId}`,
            expectedStatus: 200,
            actualStatus: response.status,
          };
        }

        if (durationMs > 3500) {
          return {
            status: "degraded",
            details: `Responded in ${durationMs}ms for ${gameId} (warn > 3500ms)`,
            expectedStatus: 200,
            actualStatus: response.status,
          };
        }

        return {
          status: "success",
          details: `Responded in ${durationMs}ms for ${gameId}`,
          expectedStatus: 200,
          actualStatus: response.status,
        };
      } catch (error: any) {
        const detail =
          error?.name === "AbortError"
            ? `Timed out after ${DEFAULT_TIMEOUT_MS}ms`
            : error?.message || "Route check failed";
        return { status: "failed", details: detail, expectedStatus: 200 };
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

export async function runApiHealthCheck(options?: {
  reason?: string;
  baseUrl?: string;
}): Promise<ApiHealthReport> {
  const runStarted = performance.now();
  const reason = options?.reason || "scheduled";
  const baseUrl = resolveBaseUrl(options?.baseUrl);

  const [databaseCheck, jobsCheck] = await Promise.all([checkDatabase(), checkCriticalJobs()]);
  const routeChecks = await Promise.all([
    ...ROUTE_TARGETS.map((target) => checkRouteTarget(baseUrl, target)),
    checkNascarLiveStatsRoute(baseUrl),
  ]);
  const checks = [databaseCheck, jobsCheck, ...routeChecks];
  const summary = summarizeStatuses(checks);
  const report: ApiHealthReport = {
    runId: randomUUID(),
    status: summarizeOverallStatus(summary),
    checkedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - runStarted),
    baseUrl,
    reason,
    summary,
    checks,
  };

  trackReport(report);
  observeApiHealthCheckRun({
    status: report.status,
    checkedAt: report.checkedAt,
    checks: checks.map((check) => ({ id: check.id, status: check.status })),
  });

  return report;
}

export function toApiHealthJobResult(report: ApiHealthReport): {
  requestCount: number;
  recordsProcessed: number;
  errorCount: number;
} {
  return {
    requestCount: report.summary.routeChecks,
    recordsProcessed: report.summary.total,
    errorCount: report.summary.failed + report.summary.degraded,
  };
}

export function getLatestApiHealthReport(): ApiHealthReport | null {
  return latestApiHealthReport;
}

export function getRecentApiHealthReports(limit: number = 10): ApiHealthReport[] {
  return apiHealthReportHistory.slice(0, Math.max(1, limit));
}

export function getApiHealthStaleThresholdMs(): number {
  return STALE_THRESHOLD_MS;
}
