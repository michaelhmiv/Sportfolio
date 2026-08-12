import "dotenv/config";
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const API_BASE_URL = "https://api.appstoreconnect.apple.com/v1";
const DEFAULT_CONFIG_PATH = "mobile/ios/app-store-submission-defaults.json";

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

const shouldApply = process.argv.includes("--apply");
const configPath = path.resolve(getArg("--config") || DEFAULT_CONFIG_PATH);
const config = JSON.parse(readFileSync(configPath, "utf8"));

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function log(message) {
  console.log(`[app-store-connect-submission-prep] ${message}`);
}

function validateSubmissionConfig() {
  if (config.bundleId !== "com.sportfoliomarket.app") {
    throw new Error("Submission config must target bundle id com.sportfoliomarket.app.");
  }

  const ageRating = config.ageRatingDeclaration;
  if (!ageRating || ageRating.advertising !== true) {
    throw new Error(
      "ageRatingDeclaration.advertising must be true because the iOS app contains rewarded video advertising.",
    );
  }

  if (ageRating.gambling !== false || ageRating.gamblingSimulated !== "NONE") {
    throw new Error(
      "The current virtual-currency build must declare gambling=false and gamblingSimulated=NONE.",
    );
  }

  const manualAgeRatingReview = config.manualAgeRatingReview;
  if (
    typeof manualAgeRatingReview?.socialMedia !== "boolean" ||
    manualAgeRatingReview?.appStoreConnectApiAutomated !== false
  ) {
    throw new Error(
      "manualAgeRatingReview must document the Social Media questionnaire answer as a manual App Store Connect check.",
    );
  }

  log(
    `Manual App Store age-rating confirmation required: Social Media=${manualAgeRatingReview.socialMedia}; Social Media disabled for users under 13=${manualAgeRatingReview.socialMediaDisabledForUsersUnder13}.`,
  );
  log(
    "The current App Store Connect API ageRatingDeclaration schema does not automate the July 2026 Social Media questionnaire field; confirm it in App Store Connect before review.",
  );
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlBuffer(buffer) {
  return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function createJwt() {
  const keyId = requiredEnv("APP_STORE_CONNECT_KEY_ID");
  const issuerId = requiredEnv("APP_STORE_CONNECT_ISSUER_ID");
  const keyContent = process.env.APP_STORE_CONNECT_API_KEY_BASE64
    ? Buffer.from(process.env.APP_STORE_CONNECT_API_KEY_BASE64, "base64").toString("utf8")
    : readFileSync(requiredEnv("APP_STORE_CONNECT_P8_PATH"), "utf8");

  const header = {
    alg: "ES256",
    kid: keyId,
    typ: "JWT",
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 20 * 60,
    aud: "appstoreconnect-v1",
  };

  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const privateKey = createPrivateKey(keyContent);
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });

  return `${signingInput}.${base64UrlBuffer(signature)}`;
}

let cachedJwt = null;

async function apiRequest(method, endpoint, body = null) {
  cachedJwt ||= createJwt();
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${cachedJwt}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const errors = payload?.errors
      ?.map((error) =>
        `${error.status || response.status} ${error.code || ""}: ${error.title || ""} ${error.detail || ""}`.trim(),
      )
      .join("\n");
    throw new Error(`App Store Connect API ${method} ${endpoint} failed:\n${errors || text}`);
  }

  return payload;
}

async function findAppByBundleId(bundleId) {
  const query = new URLSearchParams({ "filter[bundleId]": bundleId, limit: "1" });
  const response = await apiRequest("GET", `/apps?${query.toString()}`);
  const app = response.data?.[0];
  if (!app) {
    throw new Error(`No App Store Connect app found for bundle id ${bundleId}`);
  }
  return app;
}

async function readAppInfo(appId) {
  const response = await apiRequest("GET", `/apps/${appId}/appInfos?limit=1`);
  const appInfo = response.data?.[0];
  if (!appInfo) {
    throw new Error(`No appInfo found for App Store Connect app ${appId}`);
  }
  return appInfo;
}

async function readAgeRatingDeclaration(appInfoId) {
  const response = await apiRequest("GET", `/appInfos/${appInfoId}/ageRatingDeclaration`);
  if (!response.data?.id) {
    throw new Error(`No age rating declaration found for appInfo ${appInfoId}`);
  }
  return response.data;
}

async function updateContentRights(app) {
  const declaration = config.contentRightsDeclaration;
  if (!declaration) {
    log("No contentRightsDeclaration configured; skipping.");
    return;
  }

  log(`Content rights target: ${declaration}`);
  if (!shouldApply) return;

  await apiRequest("PATCH", `/apps/${app.id}`, {
    data: {
      type: "apps",
      id: app.id,
      attributes: {
        contentRightsDeclaration: declaration,
      },
    },
  });
  log("Content rights updated.");
}

async function updateAgeRating(appId) {
  const attributes = config.ageRatingDeclaration;
  if (!attributes) {
    log("No ageRatingDeclaration configured; skipping.");
    return;
  }

  const appInfo = await readAppInfo(appId);
  const declaration = await readAgeRatingDeclaration(appInfo.id);
  log(`Age rating declaration target: ${declaration.id}`);
  if (!shouldApply) return;

  await apiRequest("PATCH", `/ageRatingDeclarations/${declaration.id}`, {
    data: {
      type: "ageRatingDeclarations",
      id: declaration.id,
      attributes,
    },
  });
  log("Age rating declaration updated.");
}

async function main() {
  validateSubmissionConfig();
  const bundleId = config.bundleId || requiredEnv("IOS_APP_IDENTIFIER");
  log(`Loading App Store Connect app for ${bundleId}`);
  const app = await findAppByBundleId(bundleId);
  log(`Found app id ${app.id}; apply=${shouldApply ? "true" : "false"}`);

  await updateContentRights(app);
  await updateAgeRating(app.id);

  if (!shouldApply) {
    log("Dry run complete. Re-run with --apply to update App Store Connect.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
