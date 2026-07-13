import { expect, test } from "@playwright/test";

test("core exchange surfaces keep compact hierarchy and semantic movement cues", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/core-exchange-fixture.html", { waitUntil: "networkidle" });

  const fixture = page.getByTestId("core-exchange-fixture");
  await expect(fixture).toBeVisible();
  await expect(page.getByTestId("market-board")).toBeVisible();
  await expect(page.getByTestId("portfolio-board")).toBeVisible();
  await expect(page.getByTestId("game-hierarchy")).toBeVisible();
  await expect(fixture.getByText("▲", { exact: true }).first()).toBeVisible();
  await expect(fixture.getByText("▼", { exact: true }).first()).toBeVisible();

  const gameLabels = await page
    .getByTestId("game-hierarchy")
    .locator("[data-hierarchy-label]")
    .allTextContents();
  expect(gameLabels).toEqual([
    "Score & state",
    "Your exposure",
    "Starting lineups",
    "Scoring summary",
    "Injuries",
  ]);

  const tierColors = await page
    .locator("[data-tier]")
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundColor),
    );
  expect(new Set(tierColors).size).toBe(5);

  await expect(page).toHaveScreenshot("core-exchange-surfaces.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.001,
  });

  if (testInfo.project.name.startsWith("mobile")) {
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(0);
  }
});
