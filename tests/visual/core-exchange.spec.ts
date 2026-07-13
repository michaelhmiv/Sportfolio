import { expect, test } from "@playwright/test";

test("core exchange surfaces keep compact hierarchy and semantic movement cues", async ({
  page,
}) => {
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

  const categoryTreatments = await page.locator("[data-category]").evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return `${style.color}|${style.backgroundColor}|${style.borderColor}`;
    }),
  );
  expect(categoryTreatments).toHaveLength(9);
  expect(new Set(categoryTreatments).size).toBe(9);

  await expect(page).toHaveScreenshot("core-exchange-surfaces.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.001,
  });

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
});
