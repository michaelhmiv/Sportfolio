import type { NextFunction, Request, Response } from "express";

const DEFAULT_ALLOWED_HEADERS =
  "Authorization, Content-Type, X-Requested-With, x-client-info, apikey";
const DEFAULT_ALLOWED_METHODS = "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS";
const LOCAL_ORIGIN_PROTOCOLS = new Set(["http:", "https:", "capacitor:", "ionic:", "app:"]);
const LOCAL_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function getConfiguredAllowedOrigins(): string[] {
  return [
    process.env.PUBLIC_SITE_URL,
    process.env.SITE_URL,
    process.env.VITE_PUBLIC_SITE_URL,
    ...(process.env.MOBILE_CORS_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function normalizeOrigin(origin: string): string | null {
  try {
    const parsedOrigin = new URL(origin);
    if (
      LOCAL_ORIGIN_PROTOCOLS.has(parsedOrigin.protocol) &&
      LOCAL_ORIGIN_HOSTS.has(parsedOrigin.hostname)
    ) {
      return `${parsedOrigin.protocol}//${parsedOrigin.host}`;
    }
    return parsedOrigin.origin;
  } catch {
    return null;
  }
}

export function isAllowedCorsOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;

  try {
    const parsedOrigin = new URL(normalizedOrigin);
    if (
      LOCAL_ORIGIN_PROTOCOLS.has(parsedOrigin.protocol) &&
      LOCAL_ORIGIN_HOSTS.has(parsedOrigin.hostname)
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return getConfiguredAllowedOrigins().some((configuredOrigin) => {
    const normalizedConfiguredOrigin = normalizeOrigin(configuredOrigin);
    return normalizedConfiguredOrigin === normalizedOrigin;
  });
}

export function apiCorsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.get("origin");
  const originAllowed = isAllowedCorsOrigin(origin);

  if (originAllowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", DEFAULT_ALLOWED_METHODS);
    res.setHeader(
      "Access-Control-Allow-Headers",
      req.get("access-control-request-headers") || DEFAULT_ALLOWED_HEADERS,
    );
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  if (req.method === "OPTIONS" && origin) {
    if (originAllowed) {
      res.status(204).end();
      return;
    }

    res.status(403).json({ message: "CORS origin denied" });
    return;
  }

  next();
}
