import "dotenv/config";
import "./observability/otel";
import { logger } from "./lib/logger";
import { jobScheduler } from "./jobs/scheduler";
import { isWriteMaintenanceMode } from "./maintenance-mode";

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Stopping Sportfolio scheduled-job worker");
  jobScheduler.stop();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function main() {
  if (isWriteMaintenanceMode()) {
    throw new Error("Scheduled-job worker cannot start while write maintenance mode is active");
  }

  logger.info("Starting Sportfolio scheduled-job worker");
  await jobScheduler.initialize();
  jobScheduler.start();
  logger.info(
    { jobs: jobScheduler.getConfiguredJobNames().length },
    "Sportfolio scheduled-job worker ready",
  );
}

main().catch((error) => {
  logger.error(
    { error: error instanceof Error ? error.message : String(error) },
    "Sportfolio scheduled-job worker failed to start",
  );
  process.exit(1);
});
