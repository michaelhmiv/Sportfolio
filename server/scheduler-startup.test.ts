import { describe, expect, it, vi } from "vitest";
import { initializeScheduledWork, isScheduledJobsAuthority } from "./scheduler-startup";

function createDependencies() {
  return {
    scheduler: {
      initializeCoreJobs: vi.fn().mockResolvedValue(undefined),
      initializeApiJobs: vi.fn().mockResolvedValue(undefined),
      start: vi.fn(),
    },
    updateBotProfiles: vi.fn().mockResolvedValue(undefined),
    startAccountDeletionProcessor: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
  };
}

describe("scheduled-work startup authority", () => {
  it.each([undefined, "", "false", "1", "yes", " true-ish "])(
    "fails closed for RUN_SCHEDULED_JOBS=%s",
    async (value) => {
      const dependencies = createDependencies();

      await initializeScheduledWork(value, dependencies);

      expect(isScheduledJobsAuthority(value)).toBe(false);
      expect(dependencies.updateBotProfiles).not.toHaveBeenCalled();
      expect(dependencies.scheduler.initializeCoreJobs).not.toHaveBeenCalled();
      expect(dependencies.scheduler.initializeApiJobs).not.toHaveBeenCalled();
      expect(dependencies.scheduler.start).not.toHaveBeenCalled();
      expect(dependencies.startAccountDeletionProcessor).not.toHaveBeenCalled();
    },
  );

  it.each(["true", " TRUE ", "TrUe"])(
    "runs all automatic startup work only for literal true (%s)",
    async (value) => {
      const dependencies = createDependencies();

      await initializeScheduledWork(value, dependencies);

      expect(isScheduledJobsAuthority(value)).toBe(true);
      expect(dependencies.updateBotProfiles).toHaveBeenCalledTimes(1);
      expect(dependencies.scheduler.initializeCoreJobs).toHaveBeenCalledTimes(1);
      expect(dependencies.scheduler.start).toHaveBeenCalledTimes(1);
      expect(dependencies.scheduler.initializeApiJobs).toHaveBeenCalledTimes(1);
      expect(dependencies.startAccountDeletionProcessor).toHaveBeenCalledTimes(1);
    },
  );
});
