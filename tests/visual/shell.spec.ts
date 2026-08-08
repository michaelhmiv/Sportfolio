import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
});

test("application shell navigation is stable and emoji-free", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const isMobile = testInfo.project.name.startsWith("mobile");
  const testId = isMobile ? "bottom-navigation" : "app-sidebar";
  const shell = page.getByTestId(testId);

  // Capture and freeze the first real shell DOM emitted by provider bootstrap in one step;
  // background auth/query updates can otherwise unmount it between assertions.
  const shellText = await shell.evaluate((element) => {
    const text = element.textContent ?? "";
    const clone = element.cloneNode(true);
    document.body.replaceChildren(clone);
    document.body.style.margin = "0";
    document.body.style.background = "hsl(var(--canvas))";
    return text;
  });
  expect(shellText).not.toMatch(/[🏀🏈⚾🏎🏒🌎]/u);
  const frozenShell = page.getByTestId(testId);
  await expect(frozenShell).toBeVisible();

  if (isMobile) {
    const targets = frozenShell.getByRole("link");
    await expect(targets).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) {
      const box = await targets.nth(index).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
  }

  await expect(frozenShell).toHaveScreenshot("application-shell-navigation.png", {
    animations: "disabled",
  });
});
