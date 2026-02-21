import client from "prom-client";
import type { RequestHandler } from "express";

const enabled = process.env.METRICS_ENABLED === "true";

export const metricsEnabled = enabled;

const register = new client.Registry();

if (enabled) {
  client.collectDefaultMetrics({ register });
}

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "path", "status"],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: enabled ? [register] : [],
});

const httpExternalRequestDuration = new client.Histogram({
  name: "http_external_request_duration_ms",
  help: "External HTTP request duration in milliseconds",
  labelNames: ["host", "status"],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: enabled ? [register] : [],
});

const authTelemetryEvents = new client.Counter({
  name: "auth_telemetry_events_total",
  help: "Client-reported auth lifecycle events",
  labelNames: ["event", "code"],
  registers: enabled ? [register] : [],
});

const apiHealthRuns = new client.Counter({
  name: "api_health_runs_total",
  help: "API health-check run outcomes",
  labelNames: ["status"],
  registers: enabled ? [register] : [],
});

const apiHealthChecks = new client.Counter({
  name: "api_health_checks_total",
  help: "Individual API health check outcomes",
  labelNames: ["check", "status"],
  registers: enabled ? [register] : [],
});

const apiHealthLastRunTimestamp = new client.Gauge({
  name: "api_health_last_run_timestamp_seconds",
  help: "Unix timestamp of the latest API health-check run",
  registers: enabled ? [register] : [],
});

export function observeExternalHttpRequest(args: {
  host: string;
  status: string;
  durationMs: number;
}) {
  if (!enabled) return;
  httpExternalRequestDuration.labels(args.host, args.status).observe(args.durationMs);
}

export function observeAuthTelemetryEvent(args: { event: string; code?: string }) {
  if (!enabled) return;
  authTelemetryEvents.labels(args.event, args.code || "none").inc();
}

export function observeApiHealthCheckRun(args: {
  status: string;
  checkedAt?: string;
  checks: Array<{ id: string; status: string }>;
}) {
  if (!enabled) return;
  apiHealthRuns.labels(args.status).inc();
  for (const check of args.checks) {
    apiHealthChecks.labels(check.id, check.status).inc();
  }

  const tsSeconds = args.checkedAt ? Date.parse(args.checkedAt) / 1000 : Date.now() / 1000;
  if (Number.isFinite(tsSeconds)) {
    apiHealthLastRunTimestamp.set(tsSeconds);
  }
}

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  if (!enabled) return next();

  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const diffNs = process.hrtime.bigint() - start;
    const durationMs = Number(diffNs) / 1_000_000;
    httpRequestDuration.labels(req.method, req.path, String(res.statusCode)).observe(durationMs);
  });

  next();
};

export async function getMetricsText() {
  return register.metrics();
}

export function getMetricsContentType() {
  return register.contentType;
}
