import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const REQUIRED_FILES = [
  "mobile/ios/App/App.xcodeproj/project.pbxproj",
  "mobile/ios/App/App/Info.plist",
  "mobile/ios/App/App/AppDelegate.swift",
  "mobile/ios/App/App/capacitor.config.json",
  "mobile/ios/App/App/Base.lproj/LaunchScreen.storyboard",
];

const REQUIRED_PLUGIN_KEYS = ["SplashScreen", "StatusBar", "Keyboard"];
const IOS_CONFIG_PATH = "mobile/ios/App/App/capacitor.config.json";
const INFO_PLIST_PATH = "mobile/ios/App/App/Info.plist";
const APP_TSX_PATH = "client/src/App.tsx";

function readJson(relativePath) {
  const absolutePath = path.resolve(relativePath);
  const raw = readFileSync(absolutePath, "utf8");
  return JSON.parse(raw);
}

function printPass(message) {
  console.log(`[mobile:ios:doctor] PASS: ${message}`);
}

function printWarn(message) {
  console.log(`[mobile:ios:doctor] WARN: ${message}`);
}

function printFail(message) {
  console.log(`[mobile:ios:doctor] FAIL: ${message}`);
}

function checkXcodeInstalled() {
  const result = spawnSync("xcode-select", ["-p"], { shell: false, stdio: "pipe" });
  return result.status === 0;
}

function main() {
  let hasFailure = false;

  for (const filePath of REQUIRED_FILES) {
    const absolutePath = path.resolve(filePath);
    if (!existsSync(absolutePath)) {
      hasFailure = true;
      printFail(`Missing required iOS file: ${filePath}`);
      continue;
    }
    printPass(`Found required iOS file: ${filePath}`);
  }

  if (!hasFailure) {
    try {
      const iosConfig = readJson(IOS_CONFIG_PATH);
      const serverUrl = String(iosConfig?.server?.url || "").trim();

      if (!serverUrl) {
        hasFailure = true;
        printFail(`Generated iOS config is missing server.url (${IOS_CONFIG_PATH})`);
      } else {
        printPass(`iOS server.url is set to ${serverUrl}`);
      }

      if (serverUrl.includes("10.0.2.2")) {
        hasFailure = true;
        printFail(
          "iOS server.url is set to Android emulator host (10.0.2.2). Run `npm run mobile:sync:ios:dev` for local iOS dev or `npm run mobile:sync:prod` for production.",
        );
      }

      for (const key of REQUIRED_PLUGIN_KEYS) {
        if (!iosConfig?.plugins?.[key]) {
          hasFailure = true;
          printFail(`Missing plugins.${key} block in ${IOS_CONFIG_PATH}`);
        } else {
          printPass(`Found plugins.${key} block in ${IOS_CONFIG_PATH}`);
        }
      }
    } catch (error) {
      hasFailure = true;
      printFail(
        `Could not read ${IOS_CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    const infoPlistRaw = readFileSync(path.resolve(INFO_PLIST_PATH), "utf8");
    const hasUrlScheme = /<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>sportfolio<\/string>/m.test(
      infoPlistRaw,
    );
    if (!hasUrlScheme) {
      hasFailure = true;
      printFail(
        "Info.plist does not declare URL scheme `sportfolio`; `sportfolio://auth/callback` deep link may fail.",
      );
    } else {
      printPass("Info.plist contains `sportfolio` URL scheme for auth deep links.");
    }
  } catch (error) {
    hasFailure = true;
    printFail(
      `Could not read ${INFO_PLIST_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const appTsxRaw = readFileSync(path.resolve(APP_TSX_PATH), "utf8");
    if (!appTsxRaw.includes("sportfolio://auth/callback")) {
      hasFailure = true;
      printFail(
        "client/src/App.tsx no longer contains `sportfolio://auth/callback` handling for OAuth deep-link callbacks.",
      );
    } else {
      printPass("client/src/App.tsx still handles `sportfolio://auth/callback` deep links.");
    }
  } catch (error) {
    hasFailure = true;
    printFail(
      `Could not read ${APP_TSX_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (process.platform !== "darwin") {
    printWarn(
      `Host platform is ${process.platform}. Xcode builds/opening cannot be validated here; run \`npm run mobile:ios\` and iOS build steps on macOS.`,
    );
  } else if (!checkXcodeInstalled()) {
    printWarn("xcode-select could not find Xcode. Install Xcode before running iOS builds.");
  } else {
    printPass("Xcode toolchain detected.");
  }

  if (hasFailure) {
    process.exit(1);
  }

  console.log("[mobile:ios:doctor] All iOS guardrail checks passed.");
}

main();
