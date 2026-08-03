import type { NextFunction, Response } from "express";
import type { PluginAuthenticatedRequest } from "../../auth/plugin-oauth";

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 20_000;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let activeRequests = 0;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requestKey(req: PluginAuthenticatedRequest): string {
  if (req.pluginAuth) return `oauth:${req.pluginAuth.clientId}:${req.pluginAuth.userId}`;
  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

function pruneBuckets(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  while (buckets.size > MAX_BUCKETS) {
    const first = buckets.keys().next().value as string | undefined;
    if (!first) break;
    buckets.delete(first);
  }
}

export function pluginRateLimit(
  req: PluginAuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const now = Date.now();
  const limit = req.pluginAuth
    ? positiveInt(process.env.PLUGIN_MCP_AUTH_REQUESTS_PER_MINUTE, 120)
    : positiveInt(process.env.PLUGIN_MCP_PUBLIC_REQUESTS_PER_MINUTE, 40);
  const key = requestKey(req);
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  pruneBuckets(now);

  const remaining = Math.max(0, limit - bucket.count);
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(remaining));
  res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > limit) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    res.status(429).json({ error: "rate_limited", message: "Too many plugin requests. Try again later." });
    return;
  }
  next();
}

export function pluginConcurrencyLimit(
  _req: PluginAuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const maxConcurrent = positiveInt(process.env.PLUGIN_MCP_MAX_CONCURRENT_REQUESTS, 25);
  if (activeRequests >= maxConcurrent) {
    res.setHeader("Retry-After", "1");
    res.status(503).json({ error: "temporarily_unavailable", message: "Plugin capacity is temporarily full." });
    return;
  }

  activeRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeRequests = Math.max(0, activeRequests - 1);
  };
  res.once("finish", release);
  res.once("close", release);
  next();
}

export class PluginDeadlineError extends Error {
  readonly code = "tool_timeout";
  constructor(public readonly timeoutMs: number) {
    super(`The Sportfolio tool exceeded its ${timeoutMs}ms execution deadline.`);
    this.name = "PluginDeadlineError";
  }
}

export async function withPluginDeadline<T>(operation: Promise<T>, timeoutMs?: number): Promise<T> {
  const resolved = timeoutMs || positiveInt(process.env.PLUGIN_MCP_TOOL_TIMEOUT_MS, 12_000);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PluginDeadlineError(resolved)), resolved);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function getPluginRuntimeState() {
  return {
    activeRequests,
    rateLimitBuckets: buckets.size,
    maxConcurrentRequests: positiveInt(process.env.PLUGIN_MCP_MAX_CONCURRENT_REQUESTS, 25),
    toolTimeoutMs: positiveInt(process.env.PLUGIN_MCP_TOOL_TIMEOUT_MS, 12_000),
  };
}

export function resetPluginRuntimeStateForTests(): void {
  buckets.clear();
  activeRequests = 0;
}
