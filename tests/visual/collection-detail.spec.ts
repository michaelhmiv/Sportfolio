import { expect, test } from "@playwright/test";

const fixtureUrl = (projectName: string) =>
  `/collection-detail-fixture.html?theme=${projectName.includes("light") ? "light" : "dark"}`;

test("collection allocation recovery stays compact and actionable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-dark", "Single deterministic mobile proof");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(fixtureUrl(testInfo.project.name));
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });

  await expect(page.getByTestId("collection-completion-plan")).toBeVisible();
  await expect(page.getByText("Shares locked elsewhere")).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy or scout shares" })).toBeVisible();
  await expect(page.getByTestId("collection-mobile-action-bar")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(errors).toEqual([]);
  await expect(page).toHaveScreenshot("collection-allocation-recovery.png", { fullPage: true });
});

test("allocation disclosure is visible before confirmation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-dark", "Single deterministic mobile proof");
  await page.goto(fixtureUrl(testInfo.project.name));
  await page.getByTestId("button-open-allocation-slot-skenes").click();

  const dialog = page.getByRole("dialog", {
    name: "Manage allocation for Strikeout leader #1",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Allocated shares are locked from selling")).toBeVisible();
  await expect(dialog.getByText("may deactivate dependent master collections")).toBeVisible();
  await page.waitForTimeout(500);

  const bounds = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: window.innerWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
  await expect(page).toHaveScreenshot("collection-allocation-disclosure.png");
});

test("slot layout toggle switches the production list to a compact grid", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-dark", "Single deterministic mobile proof");
  await page.goto(fixtureUrl(testInfo.project.name));
  await expect(page.getByTestId("collection-slots")).toHaveAttribute("data-layout", "list");
  await page.getByTestId("button-slot-layout-grid").click();
  await expect(page.getByTestId("collection-slots")).toHaveAttribute("data-layout", "grid");
  await expect(page.getByTestId("button-slot-layout-grid")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("collection-slot-card-slot-skenes")).toBeVisible();
});
