import { describe, expect, it } from "vitest";
import { routeRequiresAuthBootstrap } from "./App";

describe("authenticated route bootstrap", () => {
  it("gates direct settings navigation while authentication initializes", () => {
    expect(routeRequiresAuthBootstrap("/settings")).toBe(true);
  });

  it("does not gate unrelated public routes", () => {
    expect(routeRequiresAuthBootstrap("/about")).toBe(false);
  });
});
