import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const SIMULATOR_NAME = process.env.IOS_SIMULATOR_NAME?.trim() || "iPhone 16";
const BUNDLE_ID = process.env.IOS_BUNDLE_ID?.trim() || "com.sportfolio.app";
const DERIVED_DATA_PATH = path.resolve(process.env.IOS_DERIVED_DATA || "tmp/ios-derived-data");
const ARTIFACT_DIR = path.resolve(process.env.IOS_SIM_ARTIFACT_DIR || "tmp/ios-simulator-artifacts");
const SCREENSHOT_DIR = path.join(ARTIFACT_DIR, "screenshots");
const APP_PATH = path.join(DERIVED_DATA_PATH, "Build", "Products", "Debug-iphonesimulator", "App.app");

mkdirSync(SCREENSHOT_DIR, { recursive: true });

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
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
  return result;
}

function parseRuntimeVersion(runtimeKey) {
  const tail = runtimeKey.split(".").pop() || "";
  const normalized = tail.replace(/^iOS-/, "").replace(/-/g, ".");
  const parts = normalized.split(".").map((value) => Number.parseInt(value, 10) || 0);
  return parts;
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

function findSimulator() {
  const raw = run("xcrun", ["simctl", "list", "devices", "available", "-j"]);
  const parsed = JSON.parse(raw);
  const matches = [];

  for (const [runtime, devices] of Object.entries(parsed.devices || {})) {
    for (const device of devices) {
      if (!device.isAvailable) continue;
      if (device.name !== SIMULATOR_NAME) continue;
      matches.push({
        udid: device.udid,
        name: device.name,
        runtime,
        state: device.state,
        version: parseRuntimeVersion(runtime),
      });
    }
  }

  matches.sort((left, right) => compareVersions(left.version, right.version));
  const selected = matches[0];
  if (!selected) {
    throw new Error(`Could not find an available simulator named "${SIMULATOR_NAME}".`);
  }

  writeFileSync(
    path.join(ARTIFACT_DIR, "selected-simulator.json"),
    JSON.stringify(selected, null, 2),
    "utf8",
  );

  return selected;
}

function screenshot(udid, name) {
  const outputPath = path.join(SCREENSHOT_DIR, `${name}.png`);
  run("xcrun", ["simctl", "io", udid, "screenshot", outputPath]);
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function main() {
  const simulator = findSimulator();

  tryRun("xcrun", ["simctl", "shutdown", simulator.udid]);
  tryRun("xcrun", ["simctl", "boot", simulator.udid]);
  run("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"]);

  tryRun("xcrun", ["simctl", "uninstall", simulator.udid, BUNDLE_ID]);
  run("xcrun", ["simctl", "install", simulator.udid, APP_PATH]);
  run("xcrun", ["simctl", "launch", simulator.udid, BUNDLE_ID]);

  wait(4000);
  screenshot(simulator.udid, "01-home");

  const deepLinks = [
    ["02-portfolio", "sportfolio://portfolio"],
    ["03-boosts", "sportfolio://boosts"],
    ["04-pools", "sportfolio://pools"],
  ];

  for (const [name, url] of deepLinks) {
    run("xcrun", ["simctl", "openurl", simulator.udid, url]);
    wait(2500);
    screenshot(simulator.udid, name);
  }

  const appContainer = run("xcrun", ["simctl", "get_app_container", simulator.udid, BUNDLE_ID]).trim();
  writeFileSync(
    path.join(ARTIFACT_DIR, "smoke-summary.json"),
    JSON.stringify(
      {
        simulator,
        bundleId: BUNDLE_ID,
        appPath: APP_PATH,
        appContainer,
        screenshots: deepLinks.length + 1,
      },
      null,
      2,
    ),
    "utf8",
  );
}

main();
