# Finalize Prettier cleanup only

Work only on the current PR head branch. This is a formatter-only task.

Run the repository's pinned Prettier on exactly these files:
- client/src/components/game-command-center-card.tsx
- client/src/components/game-command-center-modal.tsx
- server/mcp/public-tool-registry.ts

Then restore package.json script `format:check` to exactly `prettier . --check` while preserving `code:dead` as exactly `knip` and preserving all other package.json content and dependencies.

Do not change workflows, product behavior, tests, dependencies, configuration, Economy V2 semantics, or any unrelated file. Do not reintroduce Stack Shares, Stack Power, share-multiplier compatibility, `/power`, Supabase runtime helpers, Hermes, Agent, or SMS surfaces.

After formatting, run `npm run format:check`. If it passes, leave only the formatter output plus the package.json script restoration for the workflow's normal commit step. The workflow itself will remove this task file before committing.