import { describe, expect, it } from "vitest";

import { buildUserAgentScheduleWriteState, computeNextScheduledRunAt } from "./schedules";

describe("schedules", () => {
  it("computes the next run from the stored cron in Eastern Time", () => {
    const from = new Date("2026-03-02T14:00:00.000Z");

    const nextRun = computeNextScheduledRunAt("0 8 * * *", "daily_setup_review", from);

    expect(nextRun.toISOString()).toBe("2026-03-03T13:00:00.000Z");
  });

  it("supports stepped hour cron expressions", () => {
    const from = new Date("2026-03-02T17:20:00.000Z");

    const nextRun = computeNextScheduledRunAt("15 */6 * * *", "injury_watch", from);

    expect(nextRun.toISOString()).toBe("2026-03-02T23:15:00.000Z");
  });

  it("drops legacy sms targets while preserving existing enabled state and nextRunAt", () => {
    const existingNextRun = new Date("2026-03-03T13:00:00.000Z");

    const result = buildUserAgentScheduleWriteState({
      jobType: "daily_setup_review",
      policy: {
        source: "user_update",
      },
      existing: {
        enabled: false,
        scheduleCron: "0 8 * * *",
        channelTargets: ["sms"],
        policy: {
          source: "seeded",
        },
        nextRunAt: existingNextRun,
      },
      now: new Date("2026-03-02T14:00:00.000Z"),
    });

    expect(result.enabled).toBe(false);
    expect(result.scheduleCron).toBe("0 8 * * *");
    expect(result.channelTargets).toEqual(["in_app"]);
    expect(result.policy).toEqual({
      source: "user_update",
    });
    expect(result.nextRunAt).toBe(existingNextRun);
  });

  it("recomputes nextRunAt when the cron changes", () => {
    const result = buildUserAgentScheduleWriteState({
      jobType: "daily_setup_review",
      scheduleCron: "30 9 * * *",
      existing: {
        enabled: true,
        scheduleCron: "0 8 * * *",
        channelTargets: ["in_app"],
        policy: {},
        nextRunAt: new Date("2026-03-03T13:00:00.000Z"),
      },
      now: new Date("2026-03-02T14:00:00.000Z"),
    });

    expect(result.nextRunAt?.toISOString()).toBe("2026-03-02T14:30:00.000Z");
  });
});
