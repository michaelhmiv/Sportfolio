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
  "mobile/ios/app-store-submission-defaults.json",
  "mobile/ios/App/fastlane/metadata/review_information/notes.txt",
  "client/src/pages/privacy.tsx",
  "client/src/pages/contact.tsx",
  "client/src/hooks/use-rewarded-scout-boost.ts",
];

const REQUIRED_PLUGIN_KEYS = ["SplashScreen", "StatusBar", "Keyboard"];
const IOS_CONFIG_PATH = "mobile/ios/App/App/capacitor.config.json";
const INFO_PLIST_PATH = "mobile/ios/App/App/Info.plist";
const APP_TSX_PATH = "client/src/App.tsx";
const APP_STORE_DEFAULTS_PATH = "mobile/ios/app-store-submission-defaults.json";
const REVIEW_NOTES_PATH = "mobile/ios/App/fastlane/metadata/review_information/notes.txt";
const PRIVACY_POLICY_PATH = "client/src/pages/privacy.tsx";
const CONTACT_PATH = "client/src/pages/contact.tsx";
const REWARDED_SCOUT_HOOK_PATH = "client/src/hooks/use-rewarded-scout-boost.ts";
const MINIMUM_APP_STORE_XCODE_MAJOR = 26;

function readJson(relativePath) {
  const absolutePath = path.resolve(relativePath);
  const raw = readFileSync(absolutePath, "utf8");
  return JSON.parse(raw);
}

function readText(relativePath) {
  return readFileSync(path.resolve(relativePath), "utf8");
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

function includesAll(text, requiredFragments) {
  const normalized = text.toLowerCase();
  return requiredFragments.filter((fragment) => !normalized.includes(fragment.toLowerCase()));
}

function checkXcodeInstalled() {
  const result = spawnSync("xcode-select", ["-p"], { shell: false, stdio: "pipe" });
  return result.status === 0;
}

function readXcodeMajorVersion() {
  const result = spawnSync("xcodebuild", ["-version"], {
    shell: false,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return null;
  const match = String(result.stdout || "").match(/Xcode\s+(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function main() {
  let hasFailure = false;

  const fail = (message) => {
    hasFailure = true;
    printFail(message);
  };

  for (const filePath of REQUIRED_FILES) {
    const absolutePath = path.resolve(filePath);
    if (!existsSync(absolutePath)) {
      fail(`Missing required iOS/App Store file: ${filePath}`);
      continue;
    }
    printPass(`Found required iOS/App Store file: ${filePath}`);
  }

  if (!hasFailure) {
    try {
      const iosConfig = readJson(IOS_CONFIG_PATH);
      const serverUrl = String(iosConfig?.server?.url || "").trim();

      if (!serverUrl) {
        fail(`Generated iOS config is missing server.url (${IOS_CONFIG_PATH})`);
      } else {
        printPass(`iOS server.url is set to ${serverUrl}`);
      }

      if (serverUrl.includes("10.0.2.2")) {
        fail(
          "iOS server.url is set to Android emulator host (10.0.2.2). Run `npm run mobile:sync:ios:dev` for local iOS dev or `npm run mobile:sync:prod` for production.",
        );
      }

      if (serverUrl && !serverUrl.startsWith("https://") && !serverUrl.startsWith("http://localhost")) {
        printWarn(`iOS server.url is not HTTPS or localhost: ${serverUrl}`);
      }

      for (const key of REQUIRED_PLUGIN_KEYS) {
        if (!iosConfig?.plugins?.[key]) {
          fail(`Missing plugins.${key} block in ${IOS_CONFIG_PATH}`);
        } else {
          printPass(`Found plugins.${key} block in ${IOS_CONFIG_PATH}`);
        }
      }
    } catch (error) {
      fail(`Could not read ${IOS_CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const infoPlistRaw = readText(INFO_PLIST_PATH);
    const hasUrlScheme = /<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>sportfolio<\/string>/m.test(
      infoPlistRaw,
    );
    if (!hasUrlScheme) {
      fail(
        "Info.plist does not declare URL scheme `sportfolio`; `sportfolio://auth/callback` deep link may fail.",
      );
    } else {
      printPass("Info.plist contains `sportfolio` URL scheme for auth deep links.");
    }
  } catch (error) {
    fail(`Could not read ${INFO_PLIST_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const appTsxRaw = readText(APP_TSX_PATH);
    if (!appTsxRaw.includes("sportfolio://auth/callback")) {
      fail(
        "client/src/App.tsx no longer contains `sportfolio://auth/callback` handling for native passwordless-auth deep-link callbacks.",
      );
    } else {
      printPass("client/src/App.tsx still handles `sportfolio://auth/callback` deep links.");
    }
  } catch (error) {
    fail(`Could not read ${APP_TSX_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const submissionDefaults = readJson(APP_STORE_DEFAULTS_PATH);
    const ageRating = submissionDefaults?.ageRatingDeclaration || {};

    if (submissionDefaults?.bundleId !== "com.sportfoliomarket.app") {
      fail("App Store submission defaults must target bundle id com.sportfoliomarket.app.");
    } else {
      printPass("App Store submission defaults target the production iOS bundle id.");
    }

    if (ageRating.advertising !== true) {
      fail(
        "App Store age rating must declare advertising=true because the iOS app contains rewarded Google Mobile Ads video advertising.",
      );
    } else {
      printPass("App Store age rating correctly declares advertising=true.");
    }

    if (ageRating.gambling !== false || ageRating.gamblingSimulated !== "NONE") {
      fail("Current virtual-currency build must keep real gambling=false and simulated gambling=NONE.");
    } else {
      printPass("App Store gambling declarations match the current virtual-currency build.");
    }

    const manualAgeRatingReview = submissionDefaults?.manualAgeRatingReview;
    if (
      typeof manualAgeRatingReview?.socialMedia !== "boolean" ||
      manualAgeRatingReview?.appStoreConnectApiAutomated !== false
    ) {
      fail(
        "App Store submission defaults must document the manual social-media age-rating review because the current App Store Connect API schema does not expose that July 2026 questionnaire field.",
      );
    } else {
      printPass("Manual social-media age-rating review is explicitly tracked.");
      printWarn(
        "Reconfirm the Social Media capability answer in App Store Connect before review; Apple requires the new response for submissions beginning September 2026.",
      );
    }
  } catch (error) {
    fail(
      `Could not validate ${APP_STORE_DEFAULTS_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const reviewNotes = readText(REVIEW_NOTES_PATH);
    const forbiddenPhrases = ["being finalized", "coming soon", "in development", "credentials supplied"];
    const foundForbidden = forbiddenPhrases.filter((phrase) =>
      reviewNotes.toLowerCase().includes(phrase),
    );
    if (foundForbidden.length > 0) {
      fail(`App Review notes contain unfinished or stale wording: ${foundForbidden.join(", ")}`);
    }

    const missingReviewFragments = includesAll(reviewNotes, [
      "virtual-currency sports strategy game",
      "passwordless email sign-in",
      "one-time sign-in link",
      "new-account registration is available during review",
      "does not expose external checkout",
      "support > report an ad",
      "account deletion",
    ]);
    if (missingReviewFragments.length > 0) {
      fail(`App Review notes are missing required review guidance: ${missingReviewFragments.join(", ")}`);
    } else {
      printPass("App Review notes describe current authentication, commerce boundaries, ad reporting, and deletion flow.");
    }
  } catch (error) {
    fail(`Could not validate ${REVIEW_NOTES_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const privacyPolicy = readText(PRIVACY_POLICY_PATH);
    const missingPrivacyFragments = includesAll(privacyPolicy, [
      "google mobile ads",
      "non-personalized",
      "report an ad",
      "age-inappropriate",
      "ad response identifier",
    ]);
    if (missingPrivacyFragments.length > 0) {
      fail(`Privacy policy is missing rewarded-ad disclosure details: ${missingPrivacyFragments.join(", ")}`);
    } else {
      printPass("Privacy policy explicitly discloses rewarded advertising and ad-report diagnostics.");
    }
  } catch (error) {
    fail(`Could not validate ${PRIVACY_POLICY_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const contactPage = readText(CONTACT_PATH);
    const missingContactFragments = includesAll(contactPage, [
      "report an ad",
      "age-inappropriate",
      "buildAdReportMailto",
    ]);
    if (missingContactFragments.length > 0) {
      fail(`Support page is missing the required ad-reporting path: ${missingContactFragments.join(", ")}`);
    } else {
      printPass("Support page provides an inappropriate/age-inappropriate ad reporting path.");
    }
  } catch (error) {
    fail(`Could not validate ${CONTACT_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const rewardedHook = readText(REWARDED_SCOUT_HOOK_PATH);
    if (!rewardedHook.includes("rememberRewardedAdReportContext")) {
      fail("Rewarded-ad flow no longer records diagnostic context for user ad reports.");
    } else {
      printPass("Rewarded-ad flow records reportable diagnostic context after an ad is shown.");
    }
  } catch (error) {
    fail(
      `Could not validate ${REWARDED_SCOUT_HOOK_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (process.platform !== "darwin") {
    printWarn(
      `Host platform is ${process.platform}. Xcode builds/opening cannot be validated here; run iOS build steps on macOS or GitHub Actions.`,
    );
  } else if (!checkXcodeInstalled()) {
    printWarn("xcode-select could not find Xcode. Install Xcode before running iOS builds.");
  } else {
    printPass("Xcode toolchain detected.");
    const xcodeMajor = readXcodeMajorVersion();
    if (xcodeMajor === null) {
      fail("Could not determine the active Xcode major version.");
    } else if (xcodeMajor < MINIMUM_APP_STORE_XCODE_MAJOR) {
      fail(
        `Active Xcode ${xcodeMajor} is below the App Store minimum. Use Xcode ${MINIMUM_APP_STORE_XCODE_MAJOR} or later for current uploads.`,
      );
    } else {
      printPass(`Active Xcode ${xcodeMajor} satisfies the current App Store minimum.`);
    }
  }

  if (hasFailure) {
    process.exit(1);
  }

  console.log("[mobile:ios:doctor] All iOS and App Store readiness guardrail checks passed.");
}

main();
