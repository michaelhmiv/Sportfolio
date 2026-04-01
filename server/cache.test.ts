import { afterEach, describe, expect, it, vi } from "vitest";

import { clearAll, getOrCompute } from "./cache";

describe("getOrCompute", () => {
  afterEach(() => {
    clearAll();
  });

  it("coalesces concurrent cache misses for the same key", async () => {
    let resolveFetch: ((value: string) => void) | null = null;
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const first = getOrCompute("coalesce:key", fetcher, 60_000);
    const second = getOrCompute("coalesce:key", fetcher, 60_000);

    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFetch?.("ok");

    await expect(first).resolves.toBe("ok");
    await expect(second).resolves.toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries after a rejected in-flight fetch", async () => {
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("recovered");

    await expect(getOrCompute("retry:key", fetcher, 60_000)).rejects.toThrow("boom");
    await expect(getOrCompute("retry:key", fetcher, 60_000)).resolves.toBe("recovered");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
