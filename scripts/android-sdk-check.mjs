import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

function which(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [command], { shell: false, stdio: "pipe" });
  if (result.status !== 0) return null;
  const output = result.stdout.toString().trim().split(/\r?\n/).filter(Boolean);
  return output[0] || null;
}

function readLocalPropertiesSdkDir() {
  const localPropertiesPath = path.resolve("mobile", "android", "local.properties");
  if (!existsSync(localPropertiesPath)) return null;
  const content = readFileSync(localPropertiesPath, "utf8");
  const match = content.match(/^sdk\.dir=(.+)$/m);
  if (!match) return null;
  return match[1].replace(/\\:/g, ":").replace(/\\\\/g, "\\");
}

function checkPath(label, candidate) {
  if (!candidate) {
    console.log(`[android-sdk-check] ${label}: missing`);
    return false;
  }

  const exists = existsSync(candidate);
  console.log(`[android-sdk-check] ${label}: ${candidate} ${exists ? "(ok)" : "(missing)"}`);
  return exists;
}

function main() {
  const adbFromPath = which("adb");
  const emulatorFromPath = which("emulator");
  const sdkmanagerFromPath = which("sdkmanager");
  const avdmanagerFromPath = which("avdmanager");

  console.log(`[android-sdk-check] adb in PATH: ${adbFromPath || "missing"}`);
  console.log(`[android-sdk-check] emulator in PATH: ${emulatorFromPath || "missing"}`);
  console.log(`[android-sdk-check] sdkmanager in PATH: ${sdkmanagerFromPath || "missing"}`);
  console.log(`[android-sdk-check] avdmanager in PATH: ${avdmanagerFromPath || "missing"}`);

  const sdkDir = readLocalPropertiesSdkDir();
  console.log(`[android-sdk-check] mobile/android/local.properties sdk.dir: ${sdkDir || "unset"}`);

  const sdkRoot =
    process.env.ANDROID_SDK_ROOT ||
    process.env.ANDROID_HOME ||
    sdkDir ||
    (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk") : null);

  if (sdkRoot) {
    checkPath("sdkRoot", sdkRoot);
    checkPath("platform-tools/adb", path.join(sdkRoot, "platform-tools", "adb.exe"));
    checkPath("emulator/emulator", path.join(sdkRoot, "emulator", "emulator.exe"));
    checkPath(
      "cmdline-tools/latest/sdkmanager",
      path.join(sdkRoot, "cmdline-tools", "latest", "bin", "sdkmanager.bat"),
    );
  }
}

main();
