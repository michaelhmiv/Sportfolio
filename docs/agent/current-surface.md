# Agent Current Surface (Hermes Runtime Milestone)

This document defines the current in-app agent surface that is considered stable enough for human testing and curation.

## Operating Model

- Hermes is now the primary user-facing agent orchestrator.
- The normal Hermes path is now an in-repo orchestration flow that first uses deterministic action planning, hosted research, and account-state synthesis before falling back to the legacy PI-backed compatibility bridge.
- When `HERMES_AGENT_URL` is configured, the main app treats the Hermes sidecar as the required runtime path and records transport/correlation metadata for every turn instead of silently rerouting locally.
- The same repo can run as a dedicated self-hosted Hermes sidecar by setting `SPORTFOLIO_SERVICE_ROLE=hermes-sidecar` on a separate service and pointing `HERMES_AGENT_URL` at that service's base URL.
- Sportfolio business logic, validation, and execution remain server-owned and deterministic.
- Normal conversational economic mutations remain confirmation-gated; saved live strategies may auto-execute the approved on-platform gameplay action set inside saved guardrails.
- Hosted web research is server-side and provider-agnostic, using Brave Search when configured.
- Durable per-user agent memory is stored in the Sportfolio database and injected into agent turns before reasoning.
- Hermes now assembles a server-owned continuity brief on each run so manual chat, scheduled advisories, and strategy wakes all see the same summary of recent actions, pending work, active strategies, fresh evidence, and upcoming operator loops.
- Active users are now auto-seeded with a default daily in-app advisory schedule, and the main cron scheduler runs due Hermes advisory jobs without auto-executing risky actions.
- Live user strategies now wake through the same Hermes runtime boundary on cron/manual retry and can auto-execute the current autonomous strategy action set (`pool_buy`, `pool_sell`, LP add/remove/zap flows, `scout_set_count`, `holdings_stack_shares`, daily boost assign/remove, and watchlist add/remove) inside saved guardrails.

## Current UI Surface

- The in-app `Agents` tab is now split into `Chat` and `Strategies`, with `Strategies` acting as the primary autonomous operating desk.
- `Chat` is the general Hermes workspace for one-off requests, direct portfolio help, and confirmation-gated actions.
- `Chat` now also exposes thread continuity so Hermes's open loops, recent applied actions, and active strategy context stay visible between manual turns.
- `Strategies` is a dedicated recurring-workflow workspace with five saved slots, one active slot, dedicated strategy chats, overview/chat/rules detail views, and a continuity-first trust surface for open loops, recent actions, evidence, and next evaluations.
- Hermes responses may now include approved native `uiBlocks` such as `goal_strip`, `pending_decision`, `strategy_draft`, `strategy_status`, `rules_summary`, and `run_summary`.
- The web client renders those blocks with the app-owned terminal/trading design system; Hermes does not control arbitrary layout or executable UI.

## Supported Advisory Coverage

The agent can currently answer and synthesize across:

- broad account review (`review my setup`, `what should i do today`, `what can you do`)
- portfolio cleanup reads
- idle balance / deployable capital reads
- community boost opportunity scans
- market-intelligence reads (trend/value/upcoming window questions)
- gameplay tradeoff guidance (for example boost vs pool, buy vs LP)
- scout discussion with richer account context
- hosted current-news / injury research when the ask is time-sensitive and Brave is configured

## Supported Staged Mutations

The agent can currently stage, for confirmation:

- scout reallocations
- player-pool buys and sells
- LP add, remove, and zap flows
- stack-shares / multiplier flows
- daily boost assign and remove
- watchlist add and remove
- community boost creation

These are staged first and are only executed after an explicit confirm action from the user.

## Autonomous strategy scope

Saved live strategies may run without per-action confirmation, but only inside their saved guardrails.

Current autonomous scope includes:

- player-pool buys and sells
- LP add, remove, and zap flows
- stack shares / multiplier flows
- scout reallocations
- daily boost assign and remove
- watchlist add and remove

Explicit exclusions remain:

- external purchases and checkout flows
- premium-share / premium-access flows
- community boost creation

Broad goals are interpreted as portfolio-management mandates rather than literal single-trade instructions. The runtime should prefer paced and diversified execution over repeatedly buying one name when several names satisfy the mandate.

## Continuous operator state

- Hermes should not behave like a fresh assistant on every wake.
- Every runtime turn now carries a continuity brief assembled from server-owned state, including:
  - recent applied strategy actions
  - pending action bundles
  - live or blocked strategies
  - saved advisory schedules
  - recent evidence updates attached to the active thread
- The continuity brief is advisory context only; Sportfolio still owns execution validation and the final action boundary.

## Hosted Brave Research

- The hosted research path is available to both managed and BYOK users because it is executed on the server.
- The model receives structured research output, not unrestricted browser access.
- Research is intended for:
  - latest news
  - injury / status updates
  - time-sensitive external context
- Research-backed assistant messages should include citations.
- Thread-level research sources are exposed through the thread research endpoint.

## What Is Explicitly Not Supported Yet

- autonomous execution without saved strategy guardrails
- generalized multi-domain LLM-authored economic planning as the source of truth
- admin or destructive operational flows
- guaranteed coverage for every website path a human can perform

## Hermes-First Routing

- Normal user turns now enter the Hermes orchestrator first across web, SMS, and CLI.
- Deterministic planners still exist, but only as internal Hermes plan tools.
- PI remains installed only as fallback if the Hermes orchestration path fails.

## Runtime Skills

- Hermes may create user-scoped runtime skills over existing approved tools after it resolves a reusable workflow.
- These skills do not add any new backend capabilities or bypass confirmation.
- Shared/global skill reuse requires admin approval before promotion.

## Testing Prompts

Use these prompts as the baseline manual test set:

- `review my setup`
- `clean up my portfolio`
- `what should i do with my idle balance?`
- `who should get my community boost today?`
- `what can you do?`
- `buy $25 of <player>`
- `put <player> in my 2x boost slot today`
- `add <player> to my watchlist`
- `research the latest injury news on <player>`

## Smoke Harness

There is a lightweight internal smoke script at:

- `scripts/agent-smoke.ts`

Recommended usage:

```bash
npx tsx scripts/agent-smoke.ts --user <userId>
npx tsx scripts/agent-smoke.ts --user <userId> --include-action-plans
npx tsx scripts/agent-smoke.ts --user <userId> --include-action-plans --live-research
```

The script exercises internal agent modules directly, prints JSON, and does not confirm or execute economic mutations.
