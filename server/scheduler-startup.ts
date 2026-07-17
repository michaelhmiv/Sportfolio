interface SchedulerStartupDependencies {
  scheduler: {
    initializeCoreJobs(): Promise<void>;
    initializeApiJobs(): Promise<void>;
    start(): void;
  };
  updateBotProfiles(): Promise<void>;
  startAccountDeletionProcessor(): void;
  log(message: string): void;
  logError(message: string, error: unknown): void;
}

export function isScheduledJobsAuthority(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

/** Start automatic background work only on the explicitly-authorized deployment role. */
export async function initializeScheduledWork(
  runScheduledJobs: string | undefined,
  dependencies: SchedulerStartupDependencies,
): Promise<void> {
  if (!isScheduledJobsAuthority(runScheduledJobs)) {
    dependencies.log("Automatic scheduled work disabled (RUN_SCHEDULED_JOBS is not true)");
    return;
  }

  try {
    await dependencies.updateBotProfiles();
    dependencies.log("Bot profiles updated with unlimited daily limits");
  } catch (error) {
    dependencies.logError("Failed to update bot profiles", error);
  }

  try {
    await dependencies.scheduler.initializeCoreJobs();
    dependencies.scheduler.start();
    dependencies.log("Core jobs initialized and started");
  } catch (error) {
    dependencies.logError("Failed to initialize core jobs", error);
  }

  try {
    await dependencies.scheduler.initializeApiJobs();
    dependencies.log("API-dependent jobs initialized and started");
  } catch (error) {
    dependencies.logError("Failed to initialize API jobs", error);
  }

  try {
    dependencies.startAccountDeletionProcessor();
  } catch (error) {
    dependencies.logError("Failed to start account deletion processor", error);
  }
}
