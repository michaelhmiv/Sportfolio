# Playwright Baseline and Visual Regression Harness

Updated: 2026-07-13

## Deterministic server

The Playwright web server no longer starts the full development orchestrator or requires a database URL. `scripts/playwright-web-server.mjs` serves the Vite client in middleware mode and provides only a deterministic `/api/health` response. Browser tests continue to own their API fixtures through Playwright route interception.

This prevents local E2E startup from accidentally using production credentials or failing before Chromium launches.

## Commands

```bash
npm run e2e
npm run visual:test
npm run visual:update # intentionally accept reviewed visual changes
```

The visual suite is configured separately in `playwright.visual.config.ts` and covers:

| Project         | Browser engine | Theme | Viewport            |
| --------------- | -------------- | ----- | ------------------- |
| `desktop-dark`  | Chromium       | Dark  | 1440×900            |
| `desktop-light` | Chromium       | Light | 1440×900            |
| `mobile-dark`   | Chromium       | Dark  | iPhone 13 emulation |
| `mobile-light`  | Chromium       | Light | iPhone 13 emulation |

Each project verifies the foundation primitive gallery and the open dialog state. The eight reviewed snapshots live under `tests/visual/__screenshots__/`.

## Current results

### Foundation visual suite

- **8 passed, 0 failed**
- Re-running without `--update-snapshots` produces zero image differences.
- The test also asserts no horizontal overflow, correct dark/light activation, and 44×44 px minimum mobile button targets.

### Existing product E2E suite

`npm run e2e` now starts successfully and exercises all 25 specs:

- **11 passed**
- **14 failed**

The remaining failures target unmodified, non-foundation product behavior and must be triaged rather than hidden:

| Family             | Count | Observed mismatch                                                                                                 |
| ------------------ | ----: | ----------------------------------------------------------------------------------------------------------------- |
| MLB game card      |     4 | Specs expect expanded or legacy modal labels/content that are not visible in the current modal state.             |
| Auth/onboarding    |     2 | Verification copy differs; the auth-error transition renders duplicate matching nodes and uses `Session Expired`. |
| Mobile marketplace |     1 | Trade sheet no longer exposes the expected `Tonight's Boost Window` text.                                         |

These failures are recorded as baseline product-spec drift. They are not waived for final validation. Each must be reconciled against the intended current product contract in the relevant later PR before the final branch is considered regression-clean.

## Safety

- No `.env` file is required by the Playwright server.
- No Supabase, database, or production credentials are read or printed.
- Product API responses used by visual tests are static local fixtures or absent entirely.
- Updating snapshots is a separate explicit command so normal test runs cannot silently accept visual changes.
