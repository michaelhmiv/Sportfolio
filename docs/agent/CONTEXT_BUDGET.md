# CONTEXT_BUDGET

Last reviewed: 2026-06-01

Goal: focused context loading for the active task, not full-repo ingestion.

## Tiered Loading Strategy

### Tier 0 (Always Read First)

Target: ~20k-50k tokens max.

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `AGENT_GUIDE.md`
- `docs/agent/CONTEXT_INDEX.md`
- `docs/agent/REPO_MAP.md`
- `docs/agent/REFACTOR_QUEUE.md` (for high-friction-file tasks)
- `docs/wiki/agent/product-mechanics.md`
- `docs/wiki/agent/api-map.md`
- `docs/wiki/agent/data-model-economy.md`
- `docs/wiki/agent/runbooks.md`
- `package.json` (scripts)

Current rough Tier 0 cost (2026-06-01 snapshot): ~11.5k-19.1k tokens.

### Tier 1 (Task-Specific Entrypoints)

Load only the docs/module entrypoints for the requested task vertical:

- Backend/API: `server/routes.ts` + relevant `server/routes/*` module
- Data/schema: `shared/schema.ts`, targeted `migrations/*`, relevant storage methods
- Frontend: target page in `client/src/pages/*` + related components/hooks
- Economics: `server/amm/pool.ts`, `server/storage.ts`, relevant jobs in `server/jobs/*`
- Agent/Hermes: `server/agent/*` + relevant wiki agent docs
- Mobile: target platform subtree under `mobile/android/*` or `mobile/ios/*`

### Tier 2 (Implementation Slice)

Load only files you will edit plus immediate dependencies/tests.

Examples:

- Route change: route module + storage methods + direct tests.
- Frontend page change: page + local components + related query/helper code.
- Planner change: specific planner module + targeted tests + shared types.

### Tier 3 (On-Demand Only)

Only load when directly required:

- Full test suites and E2E artifacts.
- Historical docs/changelog notes.
- Full migration history.
- Bulk scripts directory.
- Native mobile build scaffolding and generated assets.
- Vendor mirrors and local worktree snapshots.

## Context Cost Snapshot (2026-06-01)

Rule of thumb: ~1 token per 3-5 characters.

Baseline scan (after hard excludes like `node_modules/`, `dist/`, `.git/`, build dirs):

- Total text chars: ~278,651,000
- Estimated tokens: ~55.7M-92.9M

Default-context scan (after recommended default exclusions):

- Total text chars: ~9,339,041
- Estimated tokens: ~1.87M-3.11M

Largest contributors in default-context scan:

- `server/`: ~862k-1.44M tokens
- `client/`: ~519k-866k tokens
- `scripts/`: ~127k-212k tokens
- `mobile/` (non-generated text): ~61k-102k tokens
- `shared/`: ~49k-82k tokens
- `docs/`: ~47k-79k tokens

Use `npm run context:audit` to refresh these values before large refactors.

## Default Exclusions for Broad Agent Ingestion

- `node_modules/`
- `dist/`
- `tmp/`
- `coverage/`
- `test-results/`
- `playwright-report/`
- `.git/`
- `.claude/`
- `vendor/`
- `attached_assets/`
- `mobile/ios/App/build/`
- `mobile/ios/App/Pods/`
- `mobile/android/app/build/`
- `mobile/android/.gradle/`
- `mobile/android/local.properties`
- `mobile/android/app/src/main/assets/public/assets/`
- `mobile/ios/App/App/public/assets/`
- `package-lock.json` unless dependency resolution is the task
- `.env*` except `.env.example`
- Binary/image/archive/media/font artifacts
- `docs/wiki/changelog/` unless historical docs behavior is the task

If a task requires one excluded area, opt in only that subtree.
