// verify-popup-layout.mjs
import { chromium } from "playwright";

const MOCK_SCOUTS = {
  assignments: [
    { id: "a1", playerId: "p1", scoutCount: 3, globalScoutCount: 120, player: { firstName: "Aaron", lastName: "Judge" } },
    { id: "a2", playerId: "p2", scoutCount: 2, globalScoutCount: 85, player: { firstName: "Yordan", lastName: "Alvarez" } },
    { id: "a3", playerId: "p3", scoutCount: 1, globalScoutCount: 200, player: { firstName: "Shohei", lastName: "Ohtani" } },
  ],
  totalScouts: 6,
  maxScouts: 5,
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...{ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS O)",
  });
  const page = await ctx.newPage();

  await page.route("**/api/scouts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SCOUTS) }));
  await page.route("**/api/scouts/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ earnedMinutes: 30, nextDistribution: new Date(Date.now() + 900000).toISOString() }) }));
  await page.route(/.*\.(js|css|png|svg|woff2?|ico)/, (route) => route.continue());
  await page.route("**/api/**", (route) => { if (route.request().url().includes("/api/scouts")) return; route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) }); });

  await page.goto("https://www.sportfolio.market", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Force a popup event to test rendering immediately
  await page.evaluate(() => {
    const now = Date.now();
    [
      { id: now, shortLabel: "A. Judge", amount: 0.006250 },
      { id: now + 1, shortLabel: "Y. Alvarez", amount: 0.005882 },
      { id: now + 2, shortLabel: "S. Ohtani", amount: 0.001250 },
    ].forEach((p, i) => {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("scout-live-share-popup", { detail: p }));
      }, i * 1000);
    });
  });

  // Wait for all 3 staggered popups
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "/tmp/popup-staggered-3.png", fullPage: false });

  // Check layout properties
  const layout = await page.evaluate(() => {
    const container = document.querySelector('[class*="pointer-events-none fixed"]');
    if (!container) return { error: "no container found" };
    const style = getComputedStyle(container);
    const pills = container.querySelectorAll(":scope > div");
    return {
      containerPosition: style.position,
      containerBottom: style.bottom,
      containerLeft: style.left,
      containerTransform: style.transform,
      containerZIndex: style.zIndex,
      pillCount: pills.length,
      pills: Array.from(pills).map((p, i) => {
        const s = getComputedStyle(p);
        const r = p.getBoundingClientRect();
        return {
          index: i,
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          width: r.width,
          height: r.height,
          centered: Math.abs(r.left + r.width / 2 - window.innerWidth / 2) < 5,
          bg: s.backgroundColor,
          borderRadius: s.borderRadius,
        };
      }),
    };
  });

  console.log(JSON.stringify(layout, null, 2));

  // Wait for fade-out
  await page.waitForTimeout(4000);
  const afterFade = await page.evaluate(() => {
    const container = document.querySelector('[class*="pointer-events-none fixed"]');
    return container ? container.children.length : 0;
  });
  console.log(`After fade: ${afterFade} children remaining`);

  await browser.close();
})();
