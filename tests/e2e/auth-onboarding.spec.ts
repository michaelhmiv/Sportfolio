import { test, expect, type Page } from "@playwright/test";

const MOCK_SUPABASE_URL = "http://127.0.0.1:5000/mock-supabase";

async function mockSupabaseConfig(page: Page) {
  await page.route("**/api/auth/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: MOCK_SUPABASE_URL,
        anonKey: "e2e-anon-key",
        configVersion: "e2e",
      }),
    });
  });
}

test("signup normalizes email and supports resend verification", async ({ page }) => {
  let signupEmail: string | null = null;
  let resendCalls = 0;

  await mockSupabaseConfig(page);

  await page.route(/.*\/api\/auth\/user(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unauthorized" }),
    });
  });

  await page.route("**/mock-supabase/auth/v1/**", async (route) => {
    const url = route.request().url();
    const payload = route.request().postDataJSON() as Record<string, unknown> | null;

    if (url.includes("/signup")) {
      signupEmail = (payload?.email as string) || null;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "user_e2e_signup",
            email: signupEmail,
          },
          session: null,
        }),
      });
    }

    if (url.includes("/resend")) {
      resendCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message_id: "resend_e2e_1" }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  await page.goto("/login");
  await page.getByTestId("tab-signup").click();
  await page.getByTestId("input-signup-email").fill("  USER+Tag@Example.COM  ");
  await page.getByTestId("input-signup-password").fill("password123");
  await page.getByTestId("input-confirm-password").fill("password123");
  await page.getByTestId("button-signup-submit").click();

  await expect.poll(() => signupEmail).toBe("user+tag@example.com");
  await expect(page.getByText("Verification email sent")).toBeVisible();

  await page.getByTestId("button-resend-verification").click();
  await expect.poll(() => resendCalls).toBe(1);
});

test("signup shows inline validation for malformed email", async ({ page }) => {
  await mockSupabaseConfig(page);

  await page.route(/.*\/api\/auth\/user(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unauthorized" }),
    });
  });

  await page.goto("/login");
  await page.getByTestId("tab-signup").click();
  await page.getByTestId("input-signup-email").fill("not-an-email");
  await page.getByTestId("input-signup-email").blur();

  await expect(page.getByTestId("text-signup-email-error")).toBeVisible();
  await expect(page.getByTestId("button-signup-submit")).toBeDisabled();
});

test("onboarding CTA marks complete and navigates to pools", async ({ page }) => {
  let onboardingCompleteCalls = 0;
  let hasSeenOnboarding = false;

  await mockSupabaseConfig(page);

  await page.route(/.*\/api\/auth\/user(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user_e2e_onboarding",
        email: "rookie@example.com",
        username: "rookie",
        hasSeenOnboarding,
        isPremium: false,
      }),
    });
  });

  await page.route("**/api/user/onboarding/complete", async (route) => {
    onboardingCompleteCalls += 1;
    hasSeenOnboarding = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });

  await page.route("**/api/dashboard", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: null,
        recentTrades: [],
        portfolioHistory: [],
        topHoldings: [],
        power: null,
      }),
    });
  });

  await page.route("**/api/games/insights**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ games: [] }),
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("onboarding-modal")).toBeVisible();

  await page.getByTestId("button-onboarding-cta-pools").click();

  await expect.poll(() => onboardingCompleteCalls).toBe(1);
  await expect(page).toHaveURL(/\/pools$/);
});
