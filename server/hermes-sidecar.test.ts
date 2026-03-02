import { afterEach, describe, expect, it } from "vitest";
import { isHermesSidecarMode } from "./service-role";

const originalServiceRole = process.env.SPORTFOLIO_SERVICE_ROLE;

afterEach(() => {
  if (typeof originalServiceRole === "string") {
    process.env.SPORTFOLIO_SERVICE_ROLE = originalServiceRole;
    return;
  }

  delete process.env.SPORTFOLIO_SERVICE_ROLE;
});

describe("hermes-sidecar", () => {
  it("stays off by default", () => {
    delete process.env.SPORTFOLIO_SERVICE_ROLE;
    expect(isHermesSidecarMode()).toBe(false);
  });

  it("enables sidecar mode for explicit hermes roles", () => {
    process.env.SPORTFOLIO_SERVICE_ROLE = "hermes-sidecar";
    expect(isHermesSidecarMode()).toBe(true);

    process.env.SPORTFOLIO_SERVICE_ROLE = "hermes";
    expect(isHermesSidecarMode()).toBe(true);
  });
});
