import { expect, test } from "@playwright/test";

test("passwordless login normalizes email and requests a magic link", async ({ page }) => {
  let requestedEmail: string | null = null;
  let requestedReturnTo: string | null = null;

  await page.route(/.*\/api\/auth\/user(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unauthorized" }),
    });
  });

  await page.route("**/api/auth/web/request", async (route) => {
    const payload = route.request().postDataJSON() as {
      email?: string;
      returnTo?: string;
    } | null;
    requestedEmail = payload?.email ?? null;
    requestedReturnTo = payload?.returnTo ?? null;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ accepted: true }),
    });
  });

  await page.goto("/login?redirect=%2Fportfolio");
  await expect(page.getByRole("heading", { name: "Sign in to Sportfolio" })).toBeVisible();
  await expect(page.getByText("No password is required.")).toBeVisible();

  await page.getByTestId("input-passwordless-email").fill("  USER+Tag@Example.COM  ");
  await page.getByTestId("button-passwordless-submit").click();

  await expect.poll(() => requestedEmail).toBe("user+tag@example.com");
  await expect.poll(() => requestedReturnTo).toBe("/portfolio");
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByText("user+tag@example.com")).toBeVisible();
  await expect(page.getByText(/expires after five minutes/i)).toBeVisible();
});

test("passwordless login rejects malformed email without calling the server", async ({ page }) => {
  let requests = 0;
  await page.route(/.*\/api\/auth\/user(\?.*)?$/, async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/auth/web/request", async (route) => {
    requests += 1;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ accepted: true }),
    });
  });

  await page.goto("/login");
  await page.getByTestId("input-passwordless-email").fill("not-an-email");
  await page.getByTestId("button-passwordless-submit").click();

  await expect(page.getByRole("alert")).toContainText("Enter a valid email address.");
  expect(requests).toBe(0);
});
