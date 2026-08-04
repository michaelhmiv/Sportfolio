import type { Sport } from "./contracts";

export type SyncRunStatus = "success" | "partial" | "failed";
export type SyncRunTelemetry = {
  sport: Sport;
  operation: string;
  provider: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  recordsProcessed: number;
  requestCount: number;
  errorCount: number;
  status: SyncRunStatus;
  metadata?: Record<string, string | number | boolean | null>;
};

export type SyncRunReporter = (telemetry: SyncRunTelemetry) => void | Promise<void>;

export async function withSyncTelemetry<T>(options: {
  sport: Sport;
  operation: string;
  provider: string;
  report: SyncRunReporter;
  run: () => Promise<{
    value: T;
    recordsProcessed?: number;
    requestCount?: number;
    errorCount?: number;
    metadata?: SyncRunTelemetry["metadata"];
  }>;
}): Promise<T> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  try {
    const result = await options.run();
    const errorCount = result.errorCount ?? 0;
    await options.report({
      sport: options.sport,
      operation: options.operation,
      provider: options.provider,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      recordsProcessed: result.recordsProcessed ?? 0,
      requestCount: result.requestCount ?? 0,
      errorCount,
      status: errorCount > 0 ? "partial" : "success",
      metadata: result.metadata,
    });
    return result.value;
  } catch (error) {
    await options.report({
      sport: options.sport,
      operation: options.operation,
      provider: options.provider,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      recordsProcessed: 0,
      requestCount: 0,
      errorCount: 1,
      status: "failed",
      metadata: { error: error instanceof Error ? error.message : "Unknown error" },
    });
    throw error;
  }
}
