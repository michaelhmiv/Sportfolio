import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("foundation primitives render every semantic family without overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/visual-system-fixture.html", { waitUntil: "networkidle" });

  await expect(
    page.getByRole("heading", { level: 1, name: "Sportfolio visual system" }),
  ).toBeVisible();

  for (const testId of [
    "button-primary",
    "button-secondary",
    "button-buy",
    "button-sell",
    "button-premium",
    "button-disabled",
    "badge-live",
    "badge-boost",
    "badge-premium",
    "card-interactive",
    "card-live",
    "card-premium",
    "state-loading",
    "state-empty",
    "state-error",
    "state-offline",
    "state-stale",
    "state-reconnecting",
    "state-success",
    "order-quantity",
    "sport-select",
  ]) {
    await expect(page.getByTestId(testId), `${testId} should be visible`).toBeVisible();
  }

  const layout = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    undersizedButtons: Array.from(document.querySelectorAll("button"))
      .filter((button) => button.getBoundingClientRect().width > 0)
      .filter((button) => {
        const bounds = button.getBoundingClientRect();
        return window.innerWidth < 640 && (bounds.width < 44 || bounds.height < 44);
      })
      .map((button) => button.getAttribute("data-testid") || button.textContent?.trim()),
  }));

  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.undersizedButtons).toEqual([]);
  expect(layout.theme).toBe(testInfo.project.name.endsWith("dark") ? "dark" : "light");

  await expect(page).toHaveScreenshot("foundation-primitives.png", {
    fullPage: true,
  });
});

test("overlay primitives render deterministically", async ({ page }) => {
  await page.goto("/visual-system-fixture.html", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Open order ticket" }).click();

  const dialog = page.getByRole("dialog", { name: "Confirm market order" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Place order" })).toBeVisible();

  const close = dialog.getByRole("button", { name: "Close" });
  const closeBox = await close.boundingBox();
  const isMobile = (await page.viewportSize())?.width === 390;
  expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(isMobile ? 44 : 32);
  expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(isMobile ? 44 : 32);

  await expect(page).toHaveScreenshot("foundation-dialog.png", {
    fullPage: true,
  });

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
