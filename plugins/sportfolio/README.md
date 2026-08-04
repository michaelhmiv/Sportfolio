# Sportfolio plugin package

This directory packages the Sportfolio Companion for ChatGPT and Codex. The production app derives its static tool catalog directly from Sportfolio's shared public site MCP registry so supported reads and actions remain aligned.

## Production binding

The `.app.json` file intentionally contains:

```text
REPLACE_WITH_SPORTFOLIO_PLUGIN_ASDK_APP_ID
```

Do not invent or reuse an app ID from another workspace. After the production MCP endpoint is deployed and registered in ChatGPT developer mode, copy the technical ID beginning with `plugin_asdk_app` and replace the placeholder in `.app.json`.

## Local marketplace test

The repository marketplace entry is located at `.agents/plugins/marketplace.json`. It points to `./plugins/sportfolio` relative to the repository root.

Before local installation:

1. Replace the `.app.json` placeholder with the registered Sportfolio connection ID.
2. Confirm the production or staging MCP connection points to `/mcp/plugin`.
3. Confirm OAuth is configured for connected-account reads and all write actions.
4. Restart the ChatGPT desktop app after changing the package.
5. Install Sportfolio from the `Sportfolio Development` local source.
6. Test public research, authenticated reads, staged actions, explicit confirmation, cancellation, immediate writes, and destructive-action warnings in new conversations.

## Release policy

- Keep the plugin version synchronized with the submitted release.
- Keep the marketplace static catalog in exact parity with the shared site MCP registry.
- Preserve the existing `stage_*` preview workflow and exact-bundle `confirm_pending_action` / `cancel_pending_action` finalizers.
- Require OAuth for every private-data or write tool.
- Keep all three MCP annotations explicit and accurate for every tool.
- Keep output schemas and response sanitization enabled.
- Never expose secrets, raw credentials, provider keys, authentication tokens, admin routes, internal routes, debug routes, or raw database access in tool output.
- Update submission tests and listing materials for every material action-surface change.
