import { describe, expect, it, vi } from "vitest";
import {
  isWriteMaintenanceMode,
  maintenanceWriteGuard,
  shouldBlockForMaintenance,
} from "./maintenance-mode";

describe("maintenance write guard", () => {
  it("only enables for an explicit true value", () => {
    expect(isWriteMaintenanceMode({ MAINTENANCE_MODE: "true" })).toBe(true);
    expect(isWriteMaintenanceMode({ MAINTENANCE_MODE: "TRUE" })).toBe(true);
    expect(isWriteMaintenanceMode({ MAINTENANCE_MODE: "false" })).toBe(false);
    expect(isWriteMaintenanceMode({})).toBe(false);
  });

  it("blocks every non-safe HTTP method while enabled", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "CONNECT"]) {
      expect(shouldBlockForMaintenance(method, true)).toBe(true);
    }
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(shouldBlockForMaintenance(method, true)).toBe(false);
    }
    expect(shouldBlockForMaintenance("POST", false)).toBe(false);
  });

  it("returns a retryable 503 without calling the route", () => {
    const next = vi.fn();
    const setHeader = vi.fn();
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const middleware = maintenanceWriteGuard(() => true);

    middleware({ method: "POST" } as any, { setHeader, status } as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith("Retry-After", "120");
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      code: "MAINTENANCE_MODE",
      message: "Writes are temporarily paused for maintenance",
      retryable: true,
    });
  });

  it("passes safe requests through", () => {
    const next = vi.fn();
    const middleware = maintenanceWriteGuard(() => true);
    middleware({ method: "GET" } as any, {} as any, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
