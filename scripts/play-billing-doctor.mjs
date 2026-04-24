import { readFile } from "node:fs/promises";
import process from "node:process";
import { GoogleAuth } from "google-auth-library";

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";

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

function parseServiceAccountJson(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Service account JSON is missing client_email/private_key");
  }
  return parsed;
}

async function loadServiceAccountCredentials() {
  const inline = process.env.PLAY_SERVICE_ACCOUNT_JSON?.trim();
  const filePath = process.env.PLAY_SERVICE_ACCOUNT_FILE?.trim();

  if (inline) {
    try {
      return parseServiceAccountJson(inline);
    } catch {
      const decoded = Buffer.from(inline, "base64").toString("utf8");
      return parseServiceAccountJson(decoded);
    }
  }

  if (filePath) {
    const fileContent = await readFile(filePath, "utf8");
    return parseServiceAccountJson(fileContent);
  }

  throw new Error("Missing PLAY_SERVICE_ACCOUNT_JSON or PLAY_SERVICE_ACCOUNT_FILE");
}

async function getAccessToken(credentials) {
  const auth = new GoogleAuth({
    credentials,
    scopes: [SCOPE],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
  if (!token) {
    throw new Error("Could not fetch Google Play access token");
  }
  return token;
}

async function apiRequest(path, token, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

function normalizePurchaseOptionId(productId) {
  const sanitized = productId
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  const prefixed = /^[a-z0-9]/.test(sanitized) ? sanitized : `p-${sanitized || "option"}`;
  return prefixed.slice(0, 63);
}

function microsToMoney(currencyCode, micros) {
  const units = Math.floor(micros / 1_000_000);
  const nanos = (micros - units * 1_000_000) * 1_000;
  return {
    currencyCode,
    units: String(units),
    nanos,
  };
}

function buildFallbackConvertedPrices(priceMicros) {
  const usdPrice = microsToMoney("USD", priceMicros);
  const eurPrice = microsToMoney("EUR", priceMicros);
  return {
    convertedRegionPrices: {
      US: {
        regionCode: "US",
        price: usdPrice,
      },
    },
    convertedOtherRegionsPrice: {
      usdPrice,
      eurPrice,
    },
    regionVersion: {
      version: process.env.GOOGLE_PLAY_REGIONS_VERSION?.trim() || "2022/02",
    },
  };
}

async function convertRegionPrices({ token, packageName, priceMicros }) {
  const response = await apiRequest(
    `/applications/${encodeURIComponent(packageName)}/pricing:convertRegionPrices`,
    token,
    {
      method: "POST",
      body: {
        price: microsToMoney("USD", priceMicros),
      },
    },
  );

  if (!response.ok) {
    const message = JSON.stringify(response.payload);
    const isPrecondition = response.status === 400 && message.includes("FAILED_PRECONDITION");
    if (isPrecondition) {
      console.log(
        "[play-billing-doctor] convertRegionPrices precondition failed; using fallback region pricing payload.",
      );
      return buildFallbackConvertedPrices(priceMicros);
    }
    throw new Error(`Could not convert regional prices (${response.status}): ${message}`);
  }

  return response.payload;
}

function buildOneTimeProductBody({
  packageName,
  productId,
  purchaseOptionId,
  title,
  description,
  convertedPrices,
  fallbackPriceMicros,
}) {
  const convertedEntries = Object.entries(convertedPrices?.convertedRegionPrices || {}).map(
    ([regionCode, value]) => ({
      regionCode: value?.regionCode || regionCode,
      price: value?.price,
      availability: "AVAILABLE",
    }),
  );
  convertedEntries.sort((a, b) => a.regionCode.localeCompare(b.regionCode));

  const otherRegions = convertedPrices?.convertedOtherRegionsPrice || {};
  const usdPrice = otherRegions.usdPrice || microsToMoney("USD", fallbackPriceMicros);
  const eurPrice = otherRegions.eurPrice || microsToMoney("EUR", fallbackPriceMicros);

  return {
    packageName,
    productId,
    listings: [
      {
        languageCode: "en-US",
        title,
        description,
      },
    ],
    purchaseOptions: [
      {
        purchaseOptionId,
        regionalPricingAndAvailabilityConfigs: convertedEntries,
        newRegionsConfig: {
          usdPrice,
          eurPrice,
          availability: "AVAILABLE",
        },
        buyOption: {
          legacyCompatible: true,
        },
      },
    ],
  };
}

async function getOneTimeProduct({ token, packageName, productId }) {
  const response = await apiRequest(
    `/applications/${encodeURIComponent(packageName)}/oneTimeProducts/${encodeURIComponent(productId)}`,
    token,
  );

  if (response.ok) {
    return response.payload;
  }

  if (response.status === 404) {
    return null;
  }

  throw new Error(
    `Could not read one-time product ${productId} (${response.status}): ${JSON.stringify(response.payload)}`,
  );
}

function countActivePurchaseOptions(product) {
  const options = Array.isArray(product?.purchaseOptions) ? product.purchaseOptions : [];
  const active = options.filter((option) => option?.state === "ACTIVE");
  return { options, active };
}

async function activatePurchaseOption({ token, packageName, productId, purchaseOptionId }) {
  const response = await apiRequest(
    `/applications/${encodeURIComponent(packageName)}/oneTimeProducts/${encodeURIComponent(productId)}/purchaseOptions:batchUpdateStates`,
    token,
    {
      method: "POST",
      body: {
        requests: [
          {
            activatePurchaseOptionRequest: {
              packageName,
              productId,
              purchaseOptionId,
            },
          },
        ],
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not activate purchase option ${purchaseOptionId} (${response.status}): ${JSON.stringify(response.payload)}`,
    );
  }

  return response.payload;
}

async function ensureOneTimeProduct({
  token,
  packageName,
  productId,
  priceMicros,
  title,
  description,
}) {
  const existing = await getOneTimeProduct({
    token,
    packageName,
    productId,
  });
  if (existing) {
    const { options, active } = countActivePurchaseOptions(existing);
    if (active.length > 0) {
      console.log(
        `[play-billing-doctor] Product exists with ${active.length}/${options.length} active purchase option(s): ${productId}`,
      );
      return existing;
    }
    if (options.length === 0) {
      throw new Error(
        `Product ${productId} exists but has no purchase options. Configure it in Play Console or recreate via API.`,
      );
    }
    const purchaseOptionId = options[0]?.purchaseOptionId;
    if (!purchaseOptionId) {
      throw new Error(`Product ${productId} exists but purchaseOptionId is missing.`);
    }
    console.log(
      `[play-billing-doctor] Product exists but has no active purchase options. Activating ${purchaseOptionId}...`,
    );
    await activatePurchaseOption({
      token,
      packageName,
      productId,
      purchaseOptionId,
    });
    const activated = await getOneTimeProduct({
      token,
      packageName,
      productId,
    });
    if (!activated) {
      throw new Error(`Product ${productId} disappeared after activation call.`);
    }
    return activated;
  }

  console.log(`[play-billing-doctor] Product ${productId} not found, creating one-time product...`);
  const convertedPrices = await convertRegionPrices({
    token,
    packageName,
    priceMicros,
  });
  const purchaseOptionId = normalizePurchaseOptionId(productId);

  const productBody = buildOneTimeProductBody({
    packageName,
    productId,
    purchaseOptionId,
    title,
    description,
    convertedPrices,
    fallbackPriceMicros: priceMicros,
  });

  const createResponse = await apiRequest(
    `/applications/${encodeURIComponent(packageName)}/oneTimeProducts:batchUpdate`,
    token,
    {
      method: "POST",
      body: {
        requests: [
          {
            oneTimeProduct: productBody,
            updateMask: "listings,purchaseOptions",
            regionsVersion: convertedPrices.regionVersion,
            allowMissing: true,
          },
        ],
      },
    },
  );

  if (!createResponse.ok) {
    throw new Error(
      `Could not create one-time product ${productId} (${createResponse.status}): ${JSON.stringify(createResponse.payload)}`,
    );
  }

  console.log(
    `[play-billing-doctor] Created one-time product ${productId} with purchase option ${purchaseOptionId}`,
  );
  await activatePurchaseOption({
    token,
    packageName,
    productId,
    purchaseOptionId,
  });
  console.log(`[play-billing-doctor] Activated purchase option ${purchaseOptionId}`);

  const created = await getOneTimeProduct({
    token,
    packageName,
    productId,
  });
  if (!created) {
    throw new Error(`Product ${productId} was not found after creation.`);
  }
  return created;
}

async function main() {
  const packageName = (
    getArg("--package") ||
    process.env.GOOGLE_PLAY_PACKAGE_NAME ||
    "sportfolio.market"
  ).trim();
  const productId = (
    getArg("--product") ||
    process.env.GOOGLE_PLAY_PREMIUM_PRODUCT_ID ||
    "premium_share_1"
  ).trim();
  const ensureProduct = hasFlag("--ensure");
  const title = getArg("--title") || "Premium Share";
  const description =
    getArg("--description") ||
    "One Premium Share for redeeming 30 days of Sportfolio Premium access.";
  const priceUsd = Number(
    getArg("--price-usd") || process.env.GOOGLE_PLAY_PREMIUM_PRICE_USD || "5",
  );

  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error("price-usd must be a positive number");
  }
  const priceMicros = Math.round(priceUsd * 1_000_000);

  console.log(`[play-billing-doctor] package: ${packageName}`);
  console.log(`[play-billing-doctor] product: ${productId}`);
  console.log(`[play-billing-doctor] mode: ${ensureProduct ? "ensure-product" : "doctor"}`);

  const credentials = await loadServiceAccountCredentials();
  console.log(
    `[play-billing-doctor] using service account: ${credentials.client_email} (${credentials.project_id || "unknown-project"})`,
  );

  const token = await getAccessToken(credentials);
  console.log("[play-billing-doctor] Google Play token acquired");

  if (ensureProduct) {
    const product = await ensureOneTimeProduct({
      token,
      packageName,
      productId,
      priceMicros,
      title,
      description,
    });
    const { options, active } = countActivePurchaseOptions(product);
    console.log(
      `[play-billing-doctor] ensure complete: purchaseOptions=${options.length} active=${active.length}`,
    );
    return;
  }

  const product = await getOneTimeProduct({
    token,
    packageName,
    productId,
  });

  if (product) {
    const { options, active } = countActivePurchaseOptions(product);
    if (active.length > 0) {
      console.log(
        `[play-billing-doctor] product is ready: purchaseOptions=${options.length} active=${active.length}`,
      );
      return;
    }
    console.log(
      `[play-billing-doctor] product exists but has no active purchase option. Run: npm run play:billing:ensure-product`,
    );
    process.exitCode = 2;
    return;
  }

  console.log(
    `[play-billing-doctor] product ${productId} does not exist yet. Run: npm run play:billing:ensure-product`,
  );
  process.exitCode = 2;
}

main().catch((error) => {
  console.error("[play-billing-doctor] error:", error.message || error);
  process.exit(1);
});
