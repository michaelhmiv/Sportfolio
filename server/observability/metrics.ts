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

const pluginMcpRequests = new client.Counter({
  name: "plugin_mcp_requests_total",
  help: "Marketplace MCP HTTP request outcomes",
  labelNames: ["status", "authenticated"],
  registers: enabled ? [register] : [],
});

const pluginMcpRequestLatency = new client.Histogram({
  name: "plugin_mcp_request_latency_seconds",
  help: "Marketplace MCP HTTP request latency by JSON-RPC method",
  labelNames: ["rpc_method", "status", "authenticated"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: enabled ? [register] : [],
});

const pluginMcpResponseBytes = new client.Histogram({
  name: "plugin_mcp_response_bytes",
  help: "Marketplace MCP HTTP response body bytes when Content-Length is available",
  labelNames: ["rpc_method", "status"],
  buckets: [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144],
  registers: enabled ? [register] : [],
});

const pluginMcpToolCalls = new client.Counter({
  name: "plugin_mcp_tool_calls_total",
  help: "Marketplace MCP tool call outcomes",
  labelNames: ["tool", "status", "access"],
  registers: enabled ? [register] : [],
});

const pluginMcpToolLatency = new client.Histogram({
  name: "plugin_mcp_tool_latency_seconds",
  help: "Marketplace MCP tool execution latency in seconds",
  labelNames: ["tool", "status"],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15],
  registers: enabled ? [register] : [],
});

const pluginMcpAuthFailures = new client.Counter({
  name: "plugin_mcp_auth_failures_total",
  help: "Marketplace OAuth authentication failures",
  labelNames: ["code"],
  registers: enabled ? [register] : [],
});

const pluginMcpRateLimits = new client.Counter({
  name: "plugin_mcp_rate_limit_total",
  help: "Marketplace MCP rate or concurrency limit rejections",
  labelNames: ["kind"],
  registers: enabled ? [register] : [],
});

const pluginMcpOutputBytes = new client.Histogram({
  name: "plugin_mcp_output_bytes",
  help: "Approximate serialized marketplace tool output bytes",
  labelNames: ["tool"],
  buckets: [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536],
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

export function observePluginMcpRequest(args: {
  status: string;
  authenticated: boolean;
  rpcMethod?: string;
  durationMs?: number;
  responseBytes?: number;
}) {
  if (!enabled) return;
  const authenticated = args.authenticated ? "true" : "false";
  const rpcMethod = args.rpcMethod || "unknown";
  pluginMcpRequests.labels(args.status, authenticated).inc();
  if (args.durationMs !== undefined && Number.isFinite(args.durationMs)) {
    pluginMcpRequestLatency
      .labels(rpcMethod, args.status, authenticated)
      .observe(Math.max(0, args.durationMs) / 1000);
  }
  if (args.responseBytes !== undefined && Number.isFinite(args.responseBytes)) {
    pluginMcpResponseBytes.labels(rpcMethod, args.status).observe(Math.max(0, args.responseBytes));
  }
}

export function observePluginMcpTool(args: {
  tool: string;
  status: string;
  access: string;
  durationMs: number;
  outputBytes?: number;
}) {
  if (!enabled) return;
  pluginMcpToolCalls.labels(args.tool, args.status, args.access).inc();
  pluginMcpToolLatency.labels(args.tool, args.status).observe(Math.max(0, args.durationMs) / 1000);
  if (args.outputBytes !== undefined && Number.isFinite(args.outputBytes)) {
    pluginMcpOutputBytes.labels(args.tool).observe(Math.max(0, args.outputBytes));
  }
}

export function observePluginMcpAuthFailure(code: string) {
  if (!enabled) return;
  pluginMcpAuthFailures.labels(code || "unknown").inc();
}

export function observePluginMcpLimit(kind: "rate" | "concurrency") {
  if (!enabled) return;
  pluginMcpRateLimits.labels(kind).inc();
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
