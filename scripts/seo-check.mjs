#!/usr/bin/env node

const baseUrlInput =
  process.argv[2] || process.env.PUBLIC_SITE_URL || "https://www.sportfolio.market";
const baseUrl = baseUrlInput.replace(/\/+$/, "");

const checks = [
  { name: "robots", path: "/robots.txt", status: 200 },
  { name: "sitemap", path: "/sitemap.xml", status: 200 },
  { name: "llms", path: "/llms.txt", status: 200 },
  { name: "feed-rss", path: "/feed.xml", status: 200 },
  { name: "feed-json", path: "/feed.json", status: 200 },
  { name: "public-market", path: "/api/public/market-summary", status: 200 },
  { name: "public-blog", path: "/api/public/blog", status: 200 },
  { name: "public-contests", path: "/api/public/contests", status: 200 },
];

async function checkEndpoint({ name, path, status }) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, { redirect: "manual" });
  const ok = response.status === status;
  return {
    name,
    url,
    status: response.status,
    ok,
  };
}

async function checkRedirect() {
  const url = `${baseUrl}/marketplace`;
  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location") || "";
  const ok = response.status === 301 && location.startsWith("/pools");
  return {
    name: "marketplace-redirect",
    url,
    status: response.status,
    location,
    ok,
  };
}

async function checkCanonicalTag() {
  const url = `${baseUrl}/blog`;
  const response = await fetch(url);
  const html = await response.text();
  const canonicalTag = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1];
  const expected = `${baseUrl}/blog`;
  const ok = canonicalTag === expected;
  return {
    name: "blog-canonical",
    url,
    status: response.status,
    canonicalTag,
    expected,
    ok,
  };
}

async function checkUnknownRoute404() {
  const url = `${baseUrl}/definitely-not-a-real-route-404-check`;
  const response = await fetch(url, { redirect: "manual" });
  const ok = response.status === 404;
  return {
    name: "unknown-route-404",
    url,
    status: response.status,
    ok,
  };
}

async function run() {
  const results = [];
  for (const endpoint of checks) {
    results.push(await checkEndpoint(endpoint));
  }
  results.push(await checkRedirect());
  results.push(await checkCanonicalTag());
  results.push(await checkUnknownRoute404());

  for (const result of results) {
    const status = result.ok ? "PASS" : "FAIL";
    const details = result.location
      ? ` -> ${result.location}`
      : result.canonicalTag
        ? ` canonical=${result.canonicalTag}`
        : "";
    console.log(`${status} ${result.name} [${result.status}] ${result.url}${details}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} SEO checks failed.`);
    process.exit(1);
  }

  console.log("\nAll SEO checks passed.");
}

run().catch((error) => {
  console.error("SEO check failed with runtime error:", error);
  process.exit(1);
});
