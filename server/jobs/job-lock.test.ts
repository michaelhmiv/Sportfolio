import { describe, expect, it, vi } from "vitest";
import { withJobAdvisoryLock } from "./job-lock";

describe("withJobAdvisoryLock", () => {
  it("holds a stable PostgreSQL advisory lock for the full callback and unlocks it", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    const callback = vi.fn(async () => {
      expect(query).toHaveBeenCalledTimes(1);
      expect(release).not.toHaveBeenCalled();
      return "done";
    });

    await expect(
      withJobAdvisoryLock("news_fetch", callback, { connect } as never),
    ).resolves.toEqual({
      acquired: true,
      value: "done",
    });
    expect(query).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      ["news_fetch"],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
      ["news_fetch"],
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reports contention without invoking the callback and releases the client", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ acquired: false }] });
    const release = vi.fn();
    const callback = vi.fn();

    await expect(
      withJobAdvisoryLock("news_fetch", callback, {
        connect: vi.fn().mockResolvedValue({ query, release }),
      } as never),
    ).resolves.toEqual({ acquired: false });
    expect(callback).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("unlocks and releases the client when the job throws", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] });
    const release = vi.fn();

    await expect(
      withJobAdvisoryLock(
        "news_fetch",
        async () => {
          throw new Error("job failed");
        },
        { connect: vi.fn().mockResolvedValue({ query, release }) } as never,
      ),
    ).rejects.toThrow("job failed");
    expect(query).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases the client when lock acquisition errors", async () => {
    const release = vi.fn();

    await expect(
      withJobAdvisoryLock("news_fetch", vi.fn(), {
        connect: vi.fn().mockResolvedValue({
          query: vi.fn().mockRejectedValue(new Error("database unavailable")),
          release,
        }),
      } as never),
    ).rejects.toThrow("database unavailable");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("destroys the client when unlocking errors so a session lock cannot leak", async () => {
    const release = vi.fn();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockRejectedValueOnce(new Error("unlock failed"));

    await expect(
      withJobAdvisoryLock("news_fetch", async () => "done", {
        connect: vi.fn().mockResolvedValue({ query, release }),
      } as never),
    ).rejects.toThrow("unlock failed");
    expect(release).toHaveBeenCalledWith(true);
  });

  it("destroys the client when PostgreSQL reports that the lock was not released", async () => {
    const release = vi.fn();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ unlocked: false }] });

    await expect(
      withJobAdvisoryLock("news_fetch", async () => "done", {
        connect: vi.fn().mockResolvedValue({ query, release }),
      } as never),
    ).rejects.toThrow("Failed to release advisory lock for job news_fetch");
    expect(release).toHaveBeenCalledWith(true);
  });
});
