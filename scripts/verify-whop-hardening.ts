import fs from "node:fs";

const routes = fs.readFileSync("server/routes.ts", "utf8");

function assertContains(label: string, needle: string) {
  if (!routes.includes(needle)) {
    throw new Error(`Missing safeguard: ${label}`);
  }
  console.log(`✓ ${label}`);
}

function assertNotContains(label: string, needle: string) {
  if (routes.includes(needle)) {
    throw new Error(`Unexpected unsafe pattern present: ${label}`);
  }
  console.log(`✓ ${label}`);
}

assertContains("authenticated finalize endpoint", "app.post(\"/api/checkout/finalize\", isAuthenticated");
assertContains("atomic credit guard", "sql`${whopPayments.creditedAt} IS NULL`");
assertContains("unknown plan unresolved path", "plan_id:unknown");
assertContains("webhook unresolved response", "state: \"unresolved\"");
assertNotContains("unsafe most-recent pending fallback", "using most recent pending session");

console.log("\nWhop hardening verification passed.");
