import fs from "node:fs";
import path from "node:path";

function rewriteFile(filePath, transform, skipMessage, label) {
  if (!fs.existsSync(filePath)) {
    console.log(skipMessage);
    return;
  }

  const original = fs.readFileSync(filePath, "utf8");
  const normalized = transform(original);

  if (normalized === original) {
    console.log(`[mobile] ${label} already normalized.`);
    return;
  }

  fs.writeFileSync(filePath, normalized, "utf8");
  console.log(`[mobile] ${label} normalized.`);
}

rewriteFile(
  path.resolve("mobile/ios/App/CapApp-SPM/Package.swift"),
  (original) =>
    original
      .replace(/path:\s*"([^"]*)"/g, (_match, packagePathValue) => {
        return `path: "${packagePathValue.replace(/\\/g, "/")}"`;
      })
      .replace(
        /path:\s*"[^"]*node_modules\/@capacitor\/app"/g,
        'path: "../../../../node_modules/@capacitor/app"',
      )
      .replace(
        /path:\s*"[^"]*node_modules\/@capacitor\/browser"/g,
        'path: "../../../../node_modules/@capacitor/browser"',
      ),
  "[mobile] iOS Package.swift not found; skipping SPM path normalization.",
  "iOS SPM paths",
);

rewriteFile(
  path.resolve("mobile/android/capacitor.settings.gradle"),
  (original) =>
    original
      .replace(/\\/g, "/")
      .replace(
        /project\(':capacitor-android'\)\.projectDir = new File\('[^']*node_modules\/@capacitor\/android\/capacitor'\)/g,
        "project(':capacitor-android').projectDir = new File('../../node_modules/@capacitor/android/capacitor')",
      )
      .replace(
        /project\(':capacitor-app'\)\.projectDir = new File\('[^']*node_modules\/@capacitor\/app\/android'\)/g,
        "project(':capacitor-app').projectDir = new File('../../node_modules/@capacitor/app/android')",
      )
      .replace(
        /project\(':capacitor-browser'\)\.projectDir = new File\('[^']*node_modules\/@capacitor\/browser\/android'\)/g,
        "project(':capacitor-browser').projectDir = new File('../../node_modules/@capacitor/browser/android')",
      ),
  "[mobile] Android capacitor.settings.gradle not found; skipping path normalization.",
  "Android Capacitor plugin paths",
);
