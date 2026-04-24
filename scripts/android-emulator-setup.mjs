import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

function getArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function findExecutable(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    shell: false,
    stdio: options.captureOutput ? "pipe" : "inherit",
    input: options.input,
    env: process.env,
    cwd: process.cwd(),
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function normalizePathForLocalProperties(inputPath) {
  return inputPath.replace(/\\/g, "\\\\");
}

function resolveSdkRoot() {
  const arg = getArg("--sdk-root", "");
  if (arg) return path.resolve(arg);

  if (process.env.ANDROID_SDK_ROOT) return process.env.ANDROID_SDK_ROOT;
  if (process.env.ANDROID_HOME) return process.env.ANDROID_HOME;

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "Android", "Sdk");
  }

  return path.resolve("android-sdk");
}

function ensureLocalProperties(sdkRoot) {
  const localPropertiesPath = path.resolve("mobile", "android", "local.properties");
  const contents = `sdk.dir=${normalizePathForLocalProperties(sdkRoot)}\n`;
  writeFileSync(localPropertiesPath, contents, "utf8");
  console.log(`[android-emulator-setup] Wrote ${localPropertiesPath}`);
}

function main() {
  const sdkRoot = resolveSdkRoot();
  const apiLevel = getArg("--api", "36");
  const avdName = getArg("--avd", `sportfolio-api-${apiLevel}`);
  const systemImage = `system-images;android-${apiLevel};google_apis;x86_64`;
  const packages = ["platform-tools", "emulator", `platforms;android-${apiLevel}`, systemImage];

  if (!existsSync(sdkRoot)) {
    mkdirSync(sdkRoot, { recursive: true });
    console.log(`[android-emulator-setup] Created SDK root: ${sdkRoot}`);
  }

  const sdkmanager = findExecutable([
    path.join(sdkRoot, "cmdline-tools", "latest", "bin", "sdkmanager.bat"),
    path.join(sdkRoot, "cmdline-tools", "latest", "bin", "sdkmanager"),
    path.join(sdkRoot, "cmdline-tools", "bin", "sdkmanager.bat"),
    path.join(sdkRoot, "cmdline-tools", "bin", "sdkmanager"),
  ]);

  if (!sdkmanager) {
    console.error("[android-emulator-setup] sdkmanager not found.");
    console.error("Install Android command-line tools, then rerun:");
    console.error(
      "https://developer.android.com/studio#command-tools (extract under <SDK>/cmdline-tools/latest)",
    );
    process.exit(1);
  }

  console.log(`[android-emulator-setup] Using sdkmanager: ${sdkmanager}`);
  console.log(`[android-emulator-setup] Installing packages for API ${apiLevel}...`);

  const install = run(sdkmanager, [`--sdk_root=${sdkRoot}`, ...packages]);
  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }

  const avdmanager = findExecutable([
    path.join(sdkRoot, "cmdline-tools", "latest", "bin", "avdmanager.bat"),
    path.join(sdkRoot, "cmdline-tools", "latest", "bin", "avdmanager"),
    path.join(sdkRoot, "cmdline-tools", "bin", "avdmanager.bat"),
    path.join(sdkRoot, "cmdline-tools", "bin", "avdmanager"),
  ]);

  if (!avdmanager) {
    console.warn("[android-emulator-setup] avdmanager not found. Skipping AVD creation.");
    ensureLocalProperties(sdkRoot);
    process.exit(0);
  }

  console.log(`[android-emulator-setup] Creating AVD '${avdName}'...`);
  const createAvd = run(
    avdmanager,
    [
      `--sdk_root=${sdkRoot}`,
      "create",
      "avd",
      "--name",
      avdName,
      "--package",
      systemImage,
      "--device",
      "pixel_7",
      "--force",
    ],
    { input: "no\n" },
  );
  if (createAvd.status !== 0) {
    process.exit(createAvd.status ?? 1);
  }

  ensureLocalProperties(sdkRoot);
  console.log("[android-emulator-setup] Complete.");
  console.log(
    `Start emulator with: "${path.join(sdkRoot, "emulator", process.platform === "win32" ? "emulator.exe" : "emulator")}" -avd ${avdName}`,
  );
}

main();
