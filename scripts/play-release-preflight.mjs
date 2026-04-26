import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import process from "node:process";

const REQUIRED_GITHUB_SECRETS = [
  "PLAY_SERVICE_ACCOUNT_JSON",
  "ANDROID_KEYSTORE_BASE64",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD",
];

const DEFAULT_PACKAGE_NAME = "sportfolio.market";
const DEFAULT_PRODUCT_ID = "premium_share_1";

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function normalizeSha1(value) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .match(/.{1,2}/g)
    ?.join(":");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        code: 127,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function isReadableFile(filePath) {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveRepository(argRepo) {
  if (argRepo) {
    return argRepo;
  }

  const repoLookup = await runCommand("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);
  if (repoLookup.code !== 0) {
    return null;
  }

  const repo = repoLookup.stdout.trim();
  return repo || null;
}

async function checkGithubSecrets(repo, warnings, blockers) {
  if (!repo) {
    warnings.push("Could not auto-detect GitHub repo, skipped secret checks.");
    return;
  }

  const secretsResponse = await runCommand("gh", [
    "api",
    `repos/${repo}/actions/secrets?per_page=100`,
    "--jq",
    ".secrets[].name",
  ]);
  if (secretsResponse.code !== 0) {
    warnings.push(`Could not query GitHub secrets for ${repo}.`);
    return;
  }

  const names = secretsResponse.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const nameSet = new Set(names);
  const missing = REQUIRED_GITHUB_SECRETS.filter((secret) => !nameSet.has(secret));

  if (missing.length > 0) {
    blockers.push(`Missing GitHub secrets in ${repo}: ${missing.join(", ")}`);
  }
}

async function resolveAndCheckKeystore(warnings, blockers) {
  const keystoreArg = getArg("--keystore");
  const keystorePath = path.resolve(
    process.cwd(),
    keystoreArg || process.env.ANDROID_KEYSTORE_PATH || ".env.android-upload-keystore.jks",
  );
  const password = getArg("--keystore-password") || process.env.ANDROID_KEYSTORE_PASSWORD;
  const expectedSha1Raw = getArg("--expected-sha1") || process.env.PLAY_EXPECTED_UPLOAD_SHA1;

  const hasKeystore = await isReadableFile(keystorePath);
  if (!hasKeystore) {
    blockers.push(`Android keystore file is missing or unreadable: ${keystorePath}`);
    return;
  }

  if (!password) {
    warnings.push("ANDROID_KEYSTORE_PASSWORD not set; skipped local upload-key fingerprint check.");
    return;
  }

  const keytoolCheck = await runCommand("keytool", ["-help"]);
  if (keytoolCheck.code !== 0) {
    warnings.push("`keytool` not available; skipped local upload-key fingerprint check.");
    return;
  }

  const keytoolRun = await runCommand("keytool", [
    "-list",
    "-v",
    "-keystore",
    keystorePath,
    "-storepass",
    password,
  ]);
  if (keytoolRun.code !== 0) {
    blockers.push("Could not read keystore with ANDROID_KEYSTORE_PASSWORD.");
    return;
  }

  const shaMatch = keytoolRun.stdout.match(/SHA1:\s*([0-9A-F:]+)/i);
  if (!shaMatch) {
    warnings.push("Could not parse SHA1 fingerprint from keystore.");
    return;
  }

  const actualSha1 = normalizeSha1(shaMatch[1]);
  if (!actualSha1) {
    warnings.push("Could not normalize SHA1 fingerprint from keystore output.");
    return;
  }

  console.log(`[play-release-preflight] local keystore SHA1: ${actualSha1}`);

  if (expectedSha1Raw) {
    const expectedSha1 = normalizeSha1(expectedSha1Raw);
    if (!expectedSha1) {
      warnings.push("PLAY_EXPECTED_UPLOAD_SHA1 was provided but could not be parsed.");
      return;
    }
    if (expectedSha1 !== actualSha1) {
      blockers.push(
        `Keystore SHA1 does not match expected value. expected=${expectedSha1} actual=${actualSha1}`,
      );
    }
  }
}

async function checkBillingDoctor(skipBilling, warnings, blockers) {
  if (skipBilling) {
    warnings.push("Skipped Play billing doctor check (--skip-billing).");
    return;
  }

  const env = { ...process.env };
  const localServiceAccountPath = path.resolve(process.cwd(), ".env.play-service-account.json");
  const hasLocalServiceAccount = existsSync(localServiceAccountPath);

  if (!env.PLAY_SERVICE_ACCOUNT_JSON && !env.PLAY_SERVICE_ACCOUNT_FILE && hasLocalServiceAccount) {
    env.PLAY_SERVICE_ACCOUNT_FILE = localServiceAccountPath;
  }

  if (!env.GOOGLE_PLAY_PACKAGE_NAME) {
    env.GOOGLE_PLAY_PACKAGE_NAME = DEFAULT_PACKAGE_NAME;
  }
  if (!env.GOOGLE_PLAY_PREMIUM_PRODUCT_ID) {
    env.GOOGLE_PLAY_PREMIUM_PRODUCT_ID = DEFAULT_PRODUCT_ID;
  }

  if (!env.PLAY_SERVICE_ACCOUNT_JSON && !env.PLAY_SERVICE_ACCOUNT_FILE) {
    blockers.push(
      "Missing PLAY_SERVICE_ACCOUNT_JSON/PLAY_SERVICE_ACCOUNT_FILE and no local .env.play-service-account.json found.",
    );
    return;
  }

  const billingResult = await runCommand("node", ["scripts/play-billing-doctor.mjs"], { env });
  const combinedOutput = `${billingResult.stdout}\n${billingResult.stderr}`.trim();

  if (billingResult.code === 0) {
    return;
  }

  if (combinedOutput.includes("request billing permission")) {
    blockers.push("Play billing permission is still missing for product creation/management.");
    return;
  }

  if (
    combinedOutput.includes("does not exist yet") ||
    combinedOutput.includes("no active purchase option")
  ) {
    blockers.push(
      "Google Play product is not fully ready yet. Run `npm run play:billing:ensure-product` after Play permissions are granted.",
    );
    return;
  }

  blockers.push(`Play billing doctor failed (exit ${billingResult.code}).`);
}

async function checkAndroidPushPrereqs(warnings, blockers) {
  const googleServicesPath = path.resolve(process.cwd(), "mobile/android/app/google-services.json");
  if (!existsSync(googleServicesPath)) {
    blockers.push(`Missing Android Firebase config file: ${googleServicesPath}`);
    return;
  }

  try {
    const raw = await readFile(googleServicesPath, "utf8");
    const parsed = JSON.parse(raw);
    const packageNames = new Set(
      (parsed?.client || [])
        .map((client) => client?.client_info?.android_client_info?.package_name)
        .filter(Boolean),
    );

    if (!packageNames.has(DEFAULT_PACKAGE_NAME)) {
      blockers.push(
        `google-services.json does not include expected package '${DEFAULT_PACKAGE_NAME}'.`,
      );
    }
  } catch (error) {
    blockers.push(`Could not parse google-services.json: ${error.message || error}`);
  }

  const hasFirebaseInline = Boolean(process.env.FIREBASE_ADMIN_SDK_JSON?.trim());
  const firebaseFile = process.env.FIREBASE_ADMIN_SDK_FILE?.trim();
  const hasFirebaseFile = Boolean(
    firebaseFile && existsSync(path.resolve(process.cwd(), firebaseFile)),
  );
  const hasLocalFirebaseReference = existsSync(
    path.resolve(process.cwd(), ".env.firebase-admin.json"),
  );

  if (!hasFirebaseInline && !hasFirebaseFile && !hasLocalFirebaseReference) {
    warnings.push(
      "Firebase Admin credentials not detected locally (FIREBASE_ADMIN_SDK_JSON/FIREBASE_ADMIN_SDK_FILE). Push delivery will no-op until configured in runtime env.",
    );
  }
}

async function main() {
  console.log("[play-release-preflight] starting checks...");

  const warnings = [];
  const blockers = [];
  const skipGithub = hasFlag("--skip-github");
  const skipBilling = hasFlag("--skip-billing");
  const repo = await resolveRepository(getArg("--repo"));

  if (!skipGithub) {
    await checkGithubSecrets(repo, warnings, blockers);
  } else {
    warnings.push("Skipped GitHub secret checks (--skip-github).");
  }

  await resolveAndCheckKeystore(warnings, blockers);
  await checkBillingDoctor(skipBilling, warnings, blockers);
  await checkAndroidPushPrereqs(warnings, blockers);

  if (warnings.length > 0) {
    console.log("[play-release-preflight] warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }

  if (blockers.length > 0) {
    console.log("[play-release-preflight] blockers:");
    for (const blocker of blockers) {
      console.log(`- ${blocker}`);
    }
    process.exit(1);
  }

  console.log("[play-release-preflight] all checks passed. Ready for Play internal upload.");
}

main().catch((error) => {
  console.error("[play-release-preflight] error:", error.message || error);
  process.exit(1);
});
