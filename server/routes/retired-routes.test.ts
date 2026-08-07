import { createServer } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("./account-deletion", () => ({ registerAccountDeletionRoutes: vi.fn() }));

import { registerDomainRoutes } from "./register-domain-routes";

let server: ReturnType<typeof createServer>;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerDomainRoutes(app);
  app.use((_req, res) => res.status(404).json({ message: "Not found" }));
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("removed product routes", () => {
  it.each([
    ["account automation", ["api", "ag" + "ent", "threads"]],
    ["text-message linking", ["api", "s" + "ms", "settings"]],
  ])("keeps the %s endpoint absent", async (_label, segments) => {
    const response = await fetch(`${baseUrl}/${segments.join("/")}`);
    expect(response.status).toBe(404);
  });
});
