import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const BUNDLE_ID = process.env.IOS_BUNDLE_ID?.trim() || "com.sportfoliomarket.app";
const DERIVED_DATA_PATH = path.resolve(process.env.IOS_DERIVED_DATA || "tmp/ios-derived-data");
const ARTIFACT_DIR = path.resolve(
  process.env.IOS_APP_STORE_ARTIFACT_DIR || "tmp/ios-app-store-listing",
);
const RAW_SCREENSHOT_DIR = path.join(ARTIFACT_DIR, "raw-screenshots");
const DEFAULT_DELIVER_SCREENSHOT_DIR = path.resolve("mobile/ios/App/fastlane/screenshots/en-US");
const DELIVER_SCREENSHOT_DIR = path.resolve(
  process.env.IOS_APP_STORE_SCREENSHOT_DIR || DEFAULT_DELIVER_SCREENSHOT_DIR,
);
const PRODUCTS_DIR = path.join(DERIVED_DATA_PATH, "Build", "Products", "Debug-iphonesimulator");
const DEFAULT_APP_PATH = path.join(PRODUCTS_DIR, "App.app");

const DEFAULT_SIMULATORS = ["iPhone 16 Pro Max", "iPhone 16", "iPhone 15 Pro Max"];
const DEFAULT_SHOTS = [
  ["01-home", null],
  ["02-portfolio", "sportfolio://portfolio"],
  ["03-boosts", "sportfolio://boosts"],
  ["04-player-pools", "sportfolio://pools"],
  ["05-leaderboards", "sportfolio://leaderboards"],
];

function splitList(value, fallback) {
  const items = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items?.length ? items : fallback;
}

const SIMULATOR_NAMES = splitList(
  process.env.IOS_APP_STORE_SCREENSHOT_SIMULATORS,
  DEFAULT_SIMULATORS,
);
const SCREENSHOTS = splitList(process.env.IOS_APP_STORE_SCREENSHOT_ROUTES, []).length
  ? splitList(process.env.IOS_APP_STORE_SCREENSHOT_ROUTES, []).map((item, index) => {
      const [name, url] = item.split("=").map((part) => part.trim());
      return [`${String(index + 1).padStart(2, "0")}-${name}`, url || null];
    })
  : DEFAULT_SHOTS;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });

  if (result.status !== 0) {
    const message = [
      `Command failed: ${command} ${args.join(" ")}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(message);
  }

  return result.stdout;
}

function tryRun(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function parseRuntimeVersion(runtimeKey) {
  const tail = runtimeKey.split(".").pop() || "";
  const normalized = tail.replace(/^iOS-/, "").replace(/-/g, ".");
  return normalized.split(".").map((value) => Number.parseInt(value, 10) || 0);
}

function compareVersions(left, right) {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart !== rightPart) {
      return rightPart - leftPart;
    }
  }
  return 0;
}

function loadAvailableSimulators() {
  const raw = run("xcrun", ["simctl", "list", "devices", "available", "-j"]);
  const parsed = JSON.parse(raw);
  const simulators = [];

  for (const [runtime, devices] of Object.entries(parsed.devices || {})) {
    for (const device of devices) {
      if (!device.isAvailable) continue;
      simulators.push({
        udid: device.udid,
        name: device.name,
        runtime,
        state: device.state,
        version: parseRuntimeVersion(runtime),
      });
    }
  }

  return simulators;
}

function selectSimulators() {
  const available = loadAvailableSimulators();
  const selected = [];

  for (const name of SIMULATOR_NAMES) {
    const matches = available
      .filter((device) => device.name === name)
      .sort((left, right) => compareVersions(left.version, right.version));
    if (matches[0]) {
      selected.push(matches[0]);
    }
  }

  if (selected.length === 0) {
    const names = [...new Set(available.map((device) => device.name))].sort();
    throw new Error(
      `No requested App Store screenshot simulators were available. Requested: ${SIMULATOR_NAMES.join(
        ", ",
      )}. Available: ${names.join(", ")}`,
    );
  }

  return selected;
}

function resolveBuiltAppPath() {
  if (process.env.IOS_APP_PATH?.trim()) {
    const explicitPath = path.resolve(process.env.IOS_APP_PATH.trim());
    if (!existsSync(explicitPath)) {
      throw new Error(`IOS_APP_PATH does not exist: ${explicitPath}`);
    }
    return explicitPath;
  }

  if (existsSync(DEFAULT_APP_PATH)) {
    return DEFAULT_APP_PATH;
  }

  if (!existsSync(PRODUCTS_DIR)) {
    throw new Error(`Simulator products directory does not exist: ${PRODUCTS_DIR}`);
  }

  const appBundles = readdirSync(PRODUCTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => path.join(PRODUCTS_DIR, entry.name))
    .sort();

  if (appBundles.length === 0) {
    throw new Error(
      `No .app bundle found under ${PRODUCTS_DIR}. Contents: ${readdirSync(PRODUCTS_DIR).join(", ")}`,
    );
  }

  return appBundles[0];
}

function safeResetDirectory(targetPath, allowedRoot) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(allowedRoot);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to reset ${resolvedTarget}; it is outside ${resolvedRoot}.`);
  }

  rmSync(resolvedTarget, { recursive: true, force: true });
  mkdirSync(resolvedTarget, { recursive: true });
}

function sanitizeName(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function captureScreenshot(udid, outputPath) {
  run("xcrun", ["simctl", "io", udid, "screenshot", outputPath]);
}

function captureSimulator(simulator, appPath) {
  const rawDeviceDir = path.join(RAW_SCREENSHOT_DIR, sanitizeName(simulator.name));
  mkdirSync(rawDeviceDir, { recursive: true });

  tryRun("xcrun", ["simctl", "shutdown", simulator.udid]);
  tryRun("xcrun", ["simctl", "boot", simulator.udid]);
  run("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"]);

  tryRun("xcrun", ["simctl", "uninstall", simulator.udid, BUNDLE_ID]);
  run("xcrun", ["simctl", "install", simulator.udid, appPath]);
  run("xcrun", ["simctl", "launch", simulator.udid, BUNDLE_ID]);

  const copied = [];
  wait(4500);

  for (const [shotName, url] of SCREENSHOTS) {
    if (url) {
      run("xcrun", ["simctl", "openurl", simulator.udid, url]);
      wait(3000);
    }

    const fileName = `${sanitizeName(simulator.name)}-${shotName}.png`;
    const rawPath = path.join(rawDeviceDir, fileName);
    const deliverPath = path.join(DELIVER_SCREENSHOT_DIR, fileName);
    captureScreenshot(simulator.udid, rawPath);
    copyFileSync(rawPath, deliverPath);
    copied.push({ name: shotName, url, rawPath, deliverPath });
  }

  return copied;
}

function main() {
  const appPath = resolveBuiltAppPath();
  const simulators = selectSimulators();
  safeResetDirectory(RAW_SCREENSHOT_DIR, ARTIFACT_DIR);
  safeResetDirectory(DELIVER_SCREENSHOT_DIR, path.resolve("mobile/ios/App/fastlane/screenshots"));

  const captures = [];
  for (const simulator of simulators) {
    const screenshots = captureSimulator(simulator, appPath);
    captures.push({ simulator, screenshots });
  }

  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(
    path.join(ARTIFACT_DIR, "app-store-screenshot-summary.json"),
    JSON.stringify(
      {
        bundleId: BUNDLE_ID,
        appPath,
        deliverScreenshotDir: DELIVER_SCREENSHOT_DIR,
        requestedSimulators: SIMULATOR_NAMES,
        captures,
      },
      null,
      2,
    ),
    "utf8",
  );
}

main();
