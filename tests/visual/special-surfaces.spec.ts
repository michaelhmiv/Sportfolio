import { expect, test } from "@playwright/test";

test("special surfaces keep semantic hierarchy without overflow", async ({ page }, testInfo) => {
  const theme = testInfo.project.name.includes("light") ? "light" : "dark";
  await page.goto(`/special-surfaces-fixture.html?theme=${theme}`);
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });

  const fixture = page.getByTestId("special-surfaces-fixture");
  await expect(fixture).toBeVisible();
  await expect(page.getByRole("heading", { name: "Special surfaces" })).toBeVisible();
  await expect(page.getByText("Pro market intelligence")).toBeVisible();
  await expect(page.getByText("Starting lineup confirmed")).toBeVisible();

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    fixture:
      (document.querySelector('[data-testid="special-surfaces-fixture"]')?.scrollWidth ?? 0) -
      (document.querySelector('[data-testid="special-surfaces-fixture"]')?.clientWidth ?? 0),
  }));
  expect(overflow).toEqual({ document: 0, fixture: 0 });

  await expect(page).toHaveScreenshot("special-surfaces.png", { fullPage: true });
});
