import { spawnSync } from "node:child_process";
import process from "node:process";

const gradleArgs = process.argv.slice(2);

if (gradleArgs.length === 0) {
  console.error(
    "[mobile] Missing Gradle task. Example: node scripts/run-gradle-wrapper.mjs assembleRelease",
  );
  process.exit(1);
}

const isWindows = process.platform === "win32";
const gradleCommand = isWindows ? "gradlew.bat" : "./gradlew";

const result = spawnSync(gradleCommand, gradleArgs, {
  cwd: "mobile/android",
  stdio: "inherit",
  shell: isWindows,
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.error) {
  console.error("[mobile] Failed to run Gradle wrapper:", result.error.message);
}
process.exit(1);
