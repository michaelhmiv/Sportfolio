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
});

const httpExternalRequestDuration = new client.Histogram({
  name: "http_external_request_duration_ms",
  help: "External HTTP request duration in milliseconds",
  labelNames: ["host", "status"],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

if (enabled) {
  register.registerMetric(httpRequestDuration);
  register.registerMetric(httpExternalRequestDuration);
}

export function observeExternalHttpRequest(args: {
  host: string;
  status: string;
  durationMs: number;
}) {
  if (!enabled) return;
  httpExternalRequestDuration.labels(args.host, args.status).observe(args.durationMs);
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
