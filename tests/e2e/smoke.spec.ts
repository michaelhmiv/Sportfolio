import { test, expect } from "@playwright/test";

test("health endpoint returns ready/starting", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();

  const json = (await res.json()) as { status?: string };
  expect(["ready", "starting"]).toContain(json.status);
});

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Sportfolio/i);
  await expect(page.locator("#root")).toBeVisible();
});
