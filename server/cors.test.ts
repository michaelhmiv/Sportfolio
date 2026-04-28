import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import { apiCorsMiddleware, isAllowedCorsOrigin } from "./cors";

function createTestServer() {
  const app = express();
  app.use("/api", apiCorsMiddleware);
  app.get("/api/ping", (_req, res) => {
    res.json({ ok: true });
  });

  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

describe("apiCorsMiddleware", () => {
  afterEach(() => {
    delete process.env.MOBILE_CORS_ORIGINS;
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    delete process.env.VITE_PUBLIC_SITE_URL;
  });

  it("allows localhost webview origins with credentials", async () => {
    const { baseUrl, close } = createTestServer();

    try {
      const response = await fetch(`${baseUrl}/api/ping`, {
        headers: {
          Origin: "https://localhost",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("https://localhost");
      expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    } finally {
      await close();
    }
  });

  it("allows configured production origins", async () => {
    process.env.PUBLIC_SITE_URL = "https://www.sportfolio.market";
    const { baseUrl, close } = createTestServer();

    try {
      const response = await fetch(`${baseUrl}/api/ping`, {
        headers: {
          Origin: "https://www.sportfolio.market",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "https://www.sportfolio.market",
      );
    } finally {
      await close();
    }
  });

  it("answers allowed preflight requests", async () => {
    const { baseUrl, close } = createTestServer();

    try {
      const response = await fetch(`${baseUrl}/api/ping`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://localhost",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("https://localhost");
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "authorization,content-type",
      );
    } finally {
      await close();
    }
  });

  it("rejects unknown preflight origins", async () => {
    const { baseUrl, close } = createTestServer();

    try {
      const response = await fetch(`${baseUrl}/api/ping`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "GET",
        },
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ message: "CORS origin denied" });
    } finally {
      await close();
    }
  });
});

describe("isAllowedCorsOrigin", () => {
  afterEach(() => {
    delete process.env.MOBILE_CORS_ORIGINS;
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    delete process.env.VITE_PUBLIC_SITE_URL;
  });

  it("accepts native localhost origins", () => {
    expect(isAllowedCorsOrigin("https://localhost")).toBe(true);
    expect(isAllowedCorsOrigin("capacitor://localhost")).toBe(true);
  });
});
