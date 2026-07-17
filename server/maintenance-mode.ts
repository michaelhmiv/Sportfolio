import type { RequestHandler } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isWriteMaintenanceMode(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.MAINTENANCE_MODE?.trim().toLowerCase() === "true";
}

export function shouldBlockForMaintenance(method: string, enabled: boolean): boolean {
  return enabled && !SAFE_METHODS.has(method.toUpperCase());
}

export function maintenanceWriteGuard(
  isEnabled: () => boolean = isWriteMaintenanceMode,
): RequestHandler {
  return (req, res, next) => {
    if (!shouldBlockForMaintenance(req.method, isEnabled())) {
      return next();
    }

    res.setHeader("Retry-After", "120");
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({
      code: "MAINTENANCE_MODE",
      message: "Writes are temporarily paused for maintenance",
      retryable: true,
    });
  };
}
