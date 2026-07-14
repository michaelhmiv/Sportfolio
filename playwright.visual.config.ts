import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01,
    },
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:5000",
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run e2e:server",
    url: "http://127.0.0.1:5000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop-dark",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "dark",
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "desktop-light",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "light",
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-dark",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        colorScheme: "dark",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "mobile-light",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        colorScheme: "light",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
