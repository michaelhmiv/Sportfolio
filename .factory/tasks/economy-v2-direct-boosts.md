# Sportfolio — Retired Stack MCP cleanup and staged action-review hydration

Implement one focused production PR on current `main` for Sportfolio. Do not modify trusted `.github/workflows/**` files. Do not add unrelated features.

## Current verified facts

- Economy V2 has retired Stack/Stack Power/share stacking. The active game has Singles, LP positions, direct-share Daily Boosts, scouting, market actions, and community boosts. Do not repair or preserve Stack gameplay.
- Production Railway is currently deployed from main SHA `62a5500d7e70069644a28b049fd347a587308d0a`.
- Current `server/mcp/public-tool-registry.ts` does NOT register a `stage_stack_shares` public tool anymore, but an orphan `stageStackSharesSchema` remains.
- `scripts/audit-economy-v2-retired-stack.mjs` is intended to forbid retired Stack identifiers but currently misses camelCase residue such as `stageStackSharesSchema`.
- Production logs show stale clients can still attempt `stage_stack_shares` and receive opaque MCP errors even though current discovery should not expose it.
- `render_action_review` and `ui://sportfolio/action-review/v1.html` are successfully served in production.
- `client/src/plugin-ui/sportfolio-widget-entry.ts` starts with `Loading Sportfolio…` and has no bounded terminal fallback if no recognized `view` ever arrives. This can leave a card indefinitely loading.
- `client/src/plugin-ui/sportfolio-action-widget.tsx` can also wait indefinitely if its recovery `callTool("render_action_review", ...)` promise never settles.

## Objective

1. Finish removing retired Stack mechanics/residue from active source and public MCP/ChatGPT surfaces.
2. Harden the retired-Stack audit so this cannot silently regress.
3. Fix the generic staged-action presentation lifecycle so no mounted widget can remain indefinitely loading.
4. Preserve the staged security model: `stage_* -> exact server transactionId -> render_action_review -> explicit confirm/cancel -> confirm_pending_action/cancel_pending_action`.
5. Add focused regression coverage and run broad relevant checks.

## Retired Stack cleanup

- Remove the orphan `stageStackSharesSchema` and any remaining active Stack/share-stacking identifiers from `client`, `server`, `shared`, `plugins`, `config`, `docs`, and `packages` where they represent current functionality.
- Historical database migrations may remain for audit/history if needed; do not rewrite old migration history simply to erase names.
- Do not register a compatibility `stage_stack_shares` tool. It must remain absent from MCP discovery/catalogs/snapshots/submission artifacts.
- Remove any current UI/action-review copy that still lists stacking as a supported staged action.
- Harden `scripts/audit-economy-v2-retired-stack.mjs` to catch camelCase/schema aliases and other obvious forms that could reintroduce the retired tool or Stack Power into active surfaces. Avoid false positives in the audit script's own forbidden-pattern declarations.
- Add/adjust tests or governance assertions proving `stage_stack_shares` is absent from the public registry, plugin marketplace catalog, capability snapshots/submission surfaces as applicable.
- If stale-client invocation behavior can be made deterministically sanitized without re-advertising/registering the retired tool, do so. Do NOT expose a tombstone tool merely for compatibility.

## Stage -> action-review routing audit

Trace current registration and metadata for representative staged tools:
- `stage_market_buy`
- `stage_market_sell`
- `stage_lp_add`
- `stage_lp_add_optimal`
- `stage_lp_remove`
- `stage_lp_zap_add`
- `stage_scout_assignment` and batch scouting
- Daily Boost staged actions
- Community Boost staged action

Verify stage tools return canonical staged transaction data and are not directly associated with a UI output template that expects a presentation payload. The intended transition remains:

`stage_* result.transactionId -> render_action_review(transactionId) -> action-review UI resource`

Review `server/mcp/plugin/registry.ts`, `server/mcp/plugin/ui/action-surface.ts`, `server/mcp/plugin/ui/surface.ts`, `server/mcp/plugin/ui/gameplay-surface.ts`, presentation catalogs/resources, `plugins/sportfolio/skills/sportfolio-companion/SKILL.md`, and generated/snapshot assertions.

Fix any inconsistent metadata or routing discovered. `render_action_review` should own the action-review presentation. Do not merge business execution logic into presentation code.

## Infinite-loading hardening

Primary fix must be correct hydration/routing; timeout is only a safety net.

In the shared widget bootstrap and action widget, implement deterministic terminal behavior. A mounted widget must not spin forever when:
- no tool output arrives,
- output arrives but has no recognized `view`,
- raw `stage_*` output is accidentally mounted into the shared presentation resource,
- `render_action_review` recovery call rejects,
- `render_action_review` recovery call never settles,
- auth/session state prevents loading,
- host initialization fails or never returns useful globals,
- malformed action payload is supplied.

Use a bounded timeout appropriate for host/tool hydration and render a concise visible `role="alert"`/error fallback. Do not silently retry forever. Clear timers when valid payload arrives or component unmounts. Keep existing mobile/desktop/light/dark behavior intact.

`render_action_review` server errors must remain sanitized client-side. Do not leak internal exception/database details.

Remove obsolete wording such as “stacking” from the action-review presentation description/catalog.

## Tests

Add focused automated coverage for at least:
- public registry/catalog does not contain `stage_stack_shares`;
- retired-Stack audit catches representative camelCase/snake_case active residue without flagging itself incorrectly;
- valid `action_review` routes to the action surface;
- delayed valid tool result still hydrates correctly;
- missing output reaches deterministic error state instead of permanent loading (fake timers preferred);
- malformed/unrecognized output reaches deterministic error state;
- raw staged-action envelope does not spin forever;
- action widget recovery call rejection renders error;
- action widget recovery call timeout renders error;
- valid pending action review still renders and preserves exact transaction ID semantics;
- confirmed/cancelled/expired/error transaction presentations remain terminal and do not spin;
- representative staged tools retain `staged_write`, `staged_confirmation`, `requiresConfirmation: true` and no direct presentation output-template association;
- `render_action_review` remains read-only presentation with its UI resource/output template.

Use existing test patterns. Do not weaken coverage or delete meaningful tests just to pass.

## Validation

Run the focused tests plus the practical relevant repository gates, including where available:
- `npm run check`
- `npm run lint`
- `npm run format:check`
- `npm run test:run` (or focused Vitest plus broad run if full run is too expensive)
- `npm run mcp:audit`
- `npm run mcp:smoke`
- `npm run public-tools:audit`
- `npm run plugin:ui:build`
- `npm run plugin:ui:audit`
- capability governance/snapshot checks
- `node scripts/audit-economy-v2-retired-stack.mjs`
- `npm run build`

Do not update generated snapshots unless the change is legitimate. Do not bypass failing meaningful checks.

## Implementation report

Before the workflow commits, ensure the resulting code itself documents the behavior through tests and clear names. The final PR review should be able to state the actual root causes:
- retired Stack public tool was already removed from current registry, but residue/audit gaps and stale client discovery made obsolete calls possible;
- infinite loading was caused by an unbounded widget bootstrap/recovery lifecycle when presentation output never became a recognized view or a recovery tool call never settled;
- any additional root cause discovered during implementation should be fixed and covered.

Keep this PR focused on retired Stack cleanup plus staged action-review hydration only.
