#!/usr/bin/env tsx
/**
 * CLI tool to manually trigger cron jobs for testing, verification, and one-off backfills.
 *
 * Usage:
 *   tsx server/jobs/run-once.ts mlb_roster_sync
 *   tsx server/jobs/run-once.ts mlb_schedule_sync
 *   tsx server/jobs/run-once.ts mlb_stats_sync
 *   tsx server/jobs/run-once.ts mlb_stats_backfill --start=2026-07-01 --end=2026-07-07
 *   tsx server/jobs/run-once.ts mlb_stats_backfill --date=2026-07-07
 */

import type { JobResult } from "./types";

type RunnableJob = (args: string[]) => Promise<JobResult>;

function toJobResult(result: {
  statsProcessed?: number;
  gamesProcessed?: number;
  playersAdded?: number;
  playersUpdated?: number;
  recordsProcessed?: number;
  requestCount?: number;
  errorCount?: number;
  errors?: unknown[];
  success?: boolean;
}): JobResult {
  return {
    requestCount: Number(result.requestCount || 0),
    recordsProcessed: Number(
      result.recordsProcessed ??
        result.statsProcessed ??
        result.gamesProcessed ??
        (result.playersAdded || 0) + (result.playersUpdated || 0),
    ),
    errorCount: Number(
      result.errorCount ?? result.errors?.length ?? (result.success === false ? 1 : 0),
    ),
  };
}

function readOption(args: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return null;
}

function assertDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format`);
  }
  return value;
}

function buildDateList(args: string[]): string[] {
  const explicitDate = readOption(args, "date");
  if (explicitDate) return [assertDate(explicitDate, "--date")];

  const start = readOption(args, "start");
  const end = readOption(args, "end") || start;
  if (!start || !end) {
    throw new Error(
      "mlb_stats_backfill requires --date=YYYY-MM-DD or --start=YYYY-MM-DD [--end=YYYY-MM-DD]",
    );
  }

  const startDate = new Date(`${assertDate(start, "--start")}T00:00:00.000Z`);
  const endDate = new Date(`${assertDate(end, "--end")}T00:00:00.000Z`);
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("--end must be on or after --start");
  }

  const dates: string[] = [];
  for (let cursor = new Date(startDate); cursor.getTime() <= endDate.getTime(); ) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

const VALID_JOBS: Record<string, RunnableJob> = {
  mlb_roster_sync: async () => {
    const { syncMLBRoster } = await import("./sync-mlb-roster");
    return toJobResult(await syncMLBRoster());
  },
  mlb_schedule_sync: async () => {
    const { syncMLBSchedule } = await import("./sync-mlb-schedule");
    return toJobResult(await syncMLBSchedule());
  },
  mlb_stats_sync: async () => {
    const { syncMLBStats } = await import("./sync-mlb-stats");
    return toJobResult(await syncMLBStats());
  },
  stats_sync_live: async () => {
    const { syncAllLiveStats } = await import("./sync-all-live-stats");
    return toJobResult(await syncAllLiveStats());
  },
  mlb_stats_backfill: async (args) => {
    const dates = buildDateList(args);
    const { syncMLBStatsForDates } = await import("./sync-mlb-stats");
    return toJobResult(await syncMLBStatsForDates(dates));
  },
};

async function runJob(jobName: string, args: string[]) {
  if (!(jobName in VALID_JOBS)) {
    console.error(`Invalid job name: ${jobName}`);
    console.error(`Valid jobs: ${Object.keys(VALID_JOBS).join(", ")}`);
    process.exit(1);
  }

  const handler = VALID_JOBS[jobName];

  console.log(`\n=== Running ${jobName} ===\n`);
  const startTime = Date.now();

  try {
    const result: JobResult = await handler(args);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n=== ${jobName} completed in ${duration}s ===`);
    console.log(`Records processed: ${result.recordsProcessed}`);
    console.log(`Errors: ${result.errorCount}`);
    console.log(`API requests: ${result.requestCount}`);

    if (result.errorCount > 0) {
      console.warn("\nJob completed with errors - check logs above");
      process.exit(1);
    } else {
      console.log("\n✓ Job completed successfully");
      process.exit(0);
    }
  } catch (error: any) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`\n=== ${jobName} FAILED after ${duration}s ===`);
    console.error(error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    process.exit(1);
  }
}

const [jobName, ...args] = process.argv.slice(2);

if (!jobName) {
  console.error(
    "Usage: tsx server/jobs/run-once.ts <job_name> [--date=YYYY-MM-DD | --start=YYYY-MM-DD --end=YYYY-MM-DD]",
  );
  console.error(`Valid jobs: ${Object.keys(VALID_JOBS).join(", ")}`);
  process.exit(1);
}

runJob(jobName, args);
