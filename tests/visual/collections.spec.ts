import { expect, test } from "@playwright/test";

const fixtureUrl = (projectName: string) =>
  `/collections-fixture.html?theme=${projectName.includes("light") ? "light" : "dark"}`;

test("collections are immersive, deterministic, and viewport-contained", async ({
  page,
}, testInfo) => {
  await page.goto(fixtureUrl(testInfo.project.name));
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });

  const fixture = page.getByTestId("collections-fixture");
  await expect(fixture).toBeVisible();
  await expect(page.getByTestId("collection-advanced-filter-trigger")).toBeVisible();
  await expect(page.getByTestId("featured-collection")).toBeVisible();
  await expect(page.getByTestId("fixture-master-shelf")).toBeVisible();
  await expect(page.getByTestId("fixture-trophy-shelf")).toBeVisible();
  await expect(page.getByText("Earned · Inactive").first()).toBeVisible();

  const silhouettes = await page
    .locator('[data-testid="collection-art"]')
    .evaluateAll((nodes) =>
      Array.from(new Set(nodes.map((node) => node.getAttribute("data-silhouette")))),
    );
  expect(silhouettes).toEqual(
    expect.arrayContaining(["scoreboard", "patch", "medallion", "pennant", "ticket", "crest"]),
  );

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    fixture:
      (document.querySelector('[data-testid="collections-fixture"]')?.scrollWidth ?? 0) -
      (document.querySelector('[data-testid="collections-fixture"]')?.clientWidth ?? 0),
  }));
  expect(overflow).toEqual({ document: 0, fixture: 0 });

  await expect(page).toHaveScreenshot("collections-immersive.png", { fullPage: true });
});

test("advanced filters stay compact and mobile-safe", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-dark", "Single deterministic mobile probe");

  await page.goto(fixtureUrl(testInfo.project.name));
  await page.getByTestId("collection-advanced-filter-trigger").click();

  const dialog = page.getByRole("dialog", { name: "Filter collections" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Sport filter" })).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Season filter" })).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Family filter" })).toBeVisible();
  await dialog.getByRole("button", { name: "MLB" }).click();
  await expect(dialog.getByRole("button", { name: "MLB" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("collection-advanced-filter-trigger")).toContainText("1");
  await page.getByTestId("collection-advanced-filter-trigger").click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "MLB" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "MLB" })).toHaveClass(/bg-selected/);
  await expect(dialog.getByRole("button", { name: "All" }).first()).not.toHaveClass(/bg-selected/);
  await page.waitForTimeout(500);

  const bounds = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: window.innerWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
  await expect(page).toHaveScreenshot("collections-filters-open.png");
});

test("collections reflow across every supported width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-dark", "Single deterministic responsive probe");

  for (const width of [320, 360, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixtureUrl(testInfo.project.name));
    await expect(page.getByTestId("collections-fixture")).toBeVisible();
    const documentOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(documentOverflow, `viewport ${width}px`).toBe(0);
  }
});

test("reduced motion preserves collection content and actions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-dark", "Single reduced-motion semantic probe");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(fixtureUrl(testInfo.project.name));
  await expect(page.getByTestId("featured-collection")).toBeVisible();
  await expect(page.getByText("Open set")).toBeVisible();
  await expect(page.getByTestId("fixture-trophy-shelf")).toBeVisible();
});
