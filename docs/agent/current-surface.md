# Agent Current Surface (Thin PI Test Milestone)

This document defines the current in-app agent surface that is considered stable enough for human testing and curation.

## Operating Model

- `pi-ai` / `pi-agent-core` are used as a thin reasoning and tool-call layer.
- Sportfolio business logic, validation, and execution remain server-owned and deterministic.
- All economic mutations remain confirmation-gated.
- Hosted web research is server-side and provider-agnostic, using Brave Search when configured.

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
- condense / power-up flows
- daily boost assign and remove
- watchlist add and remove
- community boost creation
- vesting claim

These are staged first and are only executed after an explicit confirm action from the user.

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

- autonomous execution without confirmation
- generalized multi-domain LLM-authored economic planning as the source of truth
- contests as an active agent capability surface
- admin or destructive operational flows
- guaranteed coverage for every website path a human can perform

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
- `claim my vesting shares`
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
