import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const defaultBaseUrl = "https://www.sportfolio.market";

function getConfigDir() {
  return path.join(os.homedir(), ".sportfolio-cli");
}

function normalizeBaseUrl(value) {
  const rawValue = (value || "").trim() || process.env.SPORTFOLIO_BASE_URL || defaultBaseUrl;
  const parsedUrl = new URL(rawValue);
  const hostname = parsedUrl.hostname.toLowerCase();
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && isLocalhost)) {
    throw new Error("CLI base URL must use HTTPS unless you are connecting to localhost");
  }

  return rawValue.replace(/\/+$/, "");
}

export function getConfigPath() {
  return path.join(getConfigDir(), "config.json");
}

export function loadConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return {
      baseUrl: normalizeBaseUrl(),
      token: "",
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      token: typeof parsed.token === "string" ? parsed.token : "",
    };
  } catch {
    return {
      baseUrl: normalizeBaseUrl(),
      token: "",
    };
  }
}

export function saveConfig(config) {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        baseUrl: normalizeBaseUrl(config.baseUrl),
        token: config.token || "",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // Best-effort on platforms that do not support POSIX-style chmod semantics.
  }
}

export function clearConfig() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

export { normalizeBaseUrl };
