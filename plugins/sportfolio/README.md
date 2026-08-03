# Sportfolio plugin package

This directory packages the read-only Sportfolio Companion for ChatGPT and Codex.

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
3. Restart the ChatGPT desktop app after changing the package.
4. Install Sportfolio from the `Sportfolio Development` local source.
5. Test in a new conversation.

## Release policy

- Keep the plugin version synchronized with the submitted release.
- Do not add write capabilities to version 1.
- Do not add credential, SMS/OTP, billing, API-token, or dynamic sidecar tools.
- Update the catalog snapshot and submission tests for any reviewed metadata change.
