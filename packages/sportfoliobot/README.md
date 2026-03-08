# sportfoliobot

Canonical local Devvit source for the live `sportfoliobot` Reddit app.

## Scope

- Pulls Reddit thread content from Sportfolio backend preview/report endpoints
- Runs a 15-minute scheduler tick per installed subreddit
- Supports mod-only preview/post/disable/retry actions
- Uses Reddit media uploads for the signed preview card when enabled

## Required App Settings

- `sportfolio-api-base-url`
- `sportfolio-reddit-bot-token`

## Required Installation Settings

- morning / pregame enable flags
- ET post times
- sport filters
- title template
- sticky / lock behavior
- image enablement

## CLI

```bash
npm --prefix packages/sportfoliobot install
npm --prefix packages/sportfoliobot run typecheck
npm --prefix packages/sportfoliobot run playtest
npm --prefix packages/sportfoliobot run upload
```

## Operations

- Stage changes in `r/sportfoliobot_dev` first.
- Promote to `r/sportfoliomarket` only after one clean morning and pregame cycle.
- Use Reddit App Analytics to compare engagement between `Morning Recap` and `Pre-Game Preview` before adding more surfaces.
