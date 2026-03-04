# SEO Operations Runbook

## Canonical URL

- Set both env vars to the same origin:
  - `PUBLIC_SITE_URL=https://www.sportfolio.market`
  - `VITE_PUBLIC_SITE_URL=https://www.sportfolio.market`
- Keep `ENFORCE_CANONICAL_HOST_REDIRECT=true` in production to force one hostname.

## Crawl Surface

- `https://www.sportfolio.market/robots.txt`
- `https://www.sportfolio.market/sitemap.xml`
- `https://www.sportfolio.market/llms.txt`
- `https://www.sportfolio.market/feed.xml`
- `https://www.sportfolio.market/feed.json`

## Public Retrieval Endpoints

- `/api/public/market-summary`
- `/api/public/blog`

These endpoints include:

- `X-Public-Data-Version`
- `X-Data-Generated-At`
- `Last-Modified`
- cache headers

## Verification

Run against production:

```bash
npm run seo:check -- https://www.sportfolio.market
```

## Search Console / Bing Checklist

1. Submit `sitemap.xml`.
2. Verify canonical host coverage.
3. Inspect representative URLs:
   - `/`
   - `/pools`
   - `/blog`
   - `/blog/<slug>`
4. Confirm unknown routes return 404.
5. Track index coverage and CWV regressions weekly.
