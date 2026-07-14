import { describe, expect, it, vi } from "vitest";
import { runCollectionReconciliation } from "./update-collections";

describe("collection reconciliation job", () => {
  it("runs the versioned reconciliation service instead of evaluating legacy rows", async () => {
    const reconcileAll = vi.fn().mockResolvedValue({
      scanned: 12,
      repaired: 2,
      errors: 0,
      publishedEvents: 3,
    });

    await expect(runCollectionReconciliation({ reconcileAll }, 250)).resolves.toEqual({
      scanned: 12,
      repaired: 2,
      errors: 0,
      publishedEvents: 3,
    });
    expect(reconcileAll).toHaveBeenCalledWith(250);
  });

  it("fails the scheduler tick when reconciliation reports partial errors", async () => {
    const reconcileAll = vi.fn().mockResolvedValue({
      scanned: 12,
      repaired: 2,
      errors: 1,
      publishedEvents: 3,
    });

    await expect(runCollectionReconciliation({ reconcileAll }, 250)).rejects.toThrow(
      "Collection reconciliation completed with 1 error(s)",
    );
  });
});
