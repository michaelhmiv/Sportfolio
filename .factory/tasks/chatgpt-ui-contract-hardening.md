# Sportfolio ChatGPT MCP App UI contract hardening

Implement this task against the current branch baseline. Keep changes narrowly scoped to the ChatGPT/plugin MCP presentation boundary, composed public-tool contracts, related tests, and request-log privacy. Do not redesign unrelated product UI or change gameplay semantics beyond the explicit contract corrections below.

## Production bugs and confirmed causes

1. `server/mcp/plugin/ui/shared-resource.ts` currently implements `installSharedPluginUiResource()` by monkey-patching `McpServer.registerTool()` and `registerResource()` at runtime. Remove this interception architecture.
2. Presentation definitions still advertise semantic resources such as `ui://sportfolio/scouting/v1.html`. Production ChatGPT fetched that stale semantic URI instead of the content-addressed shared app resource.
3. `render_scouting` invokes `list_scout_opportunities` with `{ sport, limit }`, while the public-tool definition currently uses the message-only schema. This causes `unrecognized_keys: sport, limit` in production. The native `scan_scout_opportunities` implementation already reads `sport`; make `limit` formally supported and honored too.
4. Compound renderers currently hide child-tool failures as `null`/generic records. A child schema/provider failure must not look like an empty result.
5. Player-bearing UI payloads need a single human-name fallback policy. IDs must never be used as display names.
6. Production request logging has exposed OpenAI session/subject-style request headers. Sensitive session/subject/auth identifiers must be redacted or omitted from logs.

## Required implementation

### A. Explicit shared MCP App resource; no runtime monkey-patching

Refactor `server/mcp/plugin/ui/shared-resource.ts` and plugin registration so that:

- Exactly one canonical content-addressed Sportfolio MCP App resource is registered explicitly once per plugin server.
- Canonical URI remains version/content-addressed, e.g. `ui://sportfolio/app/<content-hash>.html`, derived from the generated widget HTML so asset changes invalidate cache.
- Resource MIME type is exactly `text/html;profile=mcp-app`.
- Resource metadata declares the correct production app origin/domain and a CSP whose `resourceDomains` covers every external origin used to load widget JS/CSS/assets. Preserve the same-origin lazy-chunk architecture already shipped; do not regress back to duplicate large HTML resources.
- Remove all mutation/replacement of `server.registerTool` and `server.registerResource`.
- Export a small explicit helper for presentation-tool metadata if useful, but registration must remain normal MCP registration.
- Every presentation tool across all UI surface modules explicitly sets `_meta.ui.resourceUri` to the canonical shared resource URI.
- Keep `openai/outputTemplate` pointing to the same canonical URI as the compatibility field.
- Legacy semantic `ui://sportfolio/.../v1.html` URIs may remain only as deliberate compatibility aliases for stale clients. If retained, they must resolve to the same current widget shell/metadata and must not be the URI advertised by presentation tools/catalog entries. Prefer a centralized alias registry rather than duplicate resource implementation logic.
- Presentation catalogs should report the canonical shared resource URI for active tools, not stale semantic URIs.

Audit all presentation modules, including at minimum:
- `server/mcp/plugin/ui/surface.ts`
- `server/mcp/plugin/ui/sports-surface.ts`
- `server/mcp/plugin/ui/action-surface.ts`
- `server/mcp/plugin/ui/gameplay-surface.ts`
- `server/mcp/plugin/ui/overview-surface.ts`
- related UI catalog aggregation.

### B. Fix scouting contract at the public-tool source

In `server/mcp/public-tool-registry.ts`:

- Give `list_scout_opportunities` a formal schema supporting optional `message`, optional `sport`, and optional positive integer `limit` with a sensible bounded maximum consistent with the renderer/native scan.
- Preserve existing message compatibility.
- Use fixture args that exercise the supported filtering contract.

In `server/mcp/native-operations.ts`:

- `scan_scout_opportunities` must honor validated `limit` rather than hard-coding `.slice(0, 20)`.
- Preserve the existing default behavior when `limit` is omitted.

### C. Reusable schema-checked composed-tool invocation

Create a small reusable helper for presentation renderers that call public tools internally.

Requirements:
- Resolve the child tool definition from the public registry.
- Validate/parse composed-call arguments against the same child input schema before execution (reuse the public registry's parsing path or expose a safe parser; do not duplicate schemas).
- Execute through the normal `executePublicTool` path after validation.
- Return an explicit result discriminant such as:
  - `{ state: "ok", data: ... }`
  - `{ state: "empty", data: ... }`
  - `{ state: "unavailable", code/message: ... }`
  Exact naming may vary, but the distinction must be explicit and testable.
- A schema mismatch must surface as `unavailable`/diagnostic in a compound UI rather than being silently converted to an empty object/null.
- Required primary child calls may still fail the whole renderer when appropriate; optional/enrichment children must preserve the explicit state.
- Audit every renderer that composes public tools and migrate its optional child execution to this helper. Remove generic helpers that collapse all failures to `null` or `{ unavailable: true }` without a stable state contract.
- Add tests proving invalid composed args are caught before/at execution and cannot regress unnoticed.

### D. Player display-name normalization

Create one reusable player display-name resolver for plugin UI payload construction with this priority:

1. `playerName`
2. `displayName`
3. `name`
4. firstName + lastName when present as a human-readable fallback
5. exact fallback string `Name unavailable`

Constraints:
- Never use player ID / athlete ID / asset ID as the visible player name.
- Apply it to player-bearing payloads emitted by presentation surfaces and normalized child data where the UI expects a human label.
- Add tests for missing names and ensure raw IDs remain identifiers only.

### E. Request-log privacy hardening

Audit the MCP/plugin HTTP request logging and observability path. Do not log raw values for sensitive headers, including authorization/cookies and OpenAI/ChatGPT session or subject identifiers. Header-name matching should be case-insensitive and future-safe (at minimum redact/omit headers whose names indicate auth, cookie, session, subject, token, or API key; preserve only an explicit allowlist of operationally safe headers if that is cleaner).

Add focused tests that construct representative request headers and verify sensitive values never appear in the serialized/loggable output. Do not remove useful method/path/status/duration/response-size observability.

### F. Protocol/resource and regression tests

Do not rely only on mocked `registerTool()` assertions. Add or expand tests that instantiate the actual plugin MCP v2 server and exercise protocol-visible discovery/resource behavior sufficiently to prove:

- there is one canonical content-addressed MCP App resource;
- every presentation tool advertises the canonical `_meta.ui.resourceUri` and matching `openai/outputTemplate`;
- the canonical resource can be read and returns `text/html;profile=mcp-app`;
- resource `_meta.ui.domain` and CSP `resourceDomains` match the actual widget asset origin;
- any legacy semantic aliases, if kept, are aliases only and are not advertised by active tools;
- no runtime method monkey-patching is required;
- `render_scouting` with `{ sport: "mlb", limit: 6 }` no longer produces `unrecognized_keys`;
- composed child failure states distinguish empty data from unavailable/error;
- player name fallback never renders an ID as the name;
- sensitive request headers are redacted.

Audit existing tests such as `shared-resource.test.ts`, presentation surface tests, plugin server/protocol smoke tests, and update them rather than leaving tests coupled to the monkey-patch implementation.

## Current architecture to preserve

- Keep the generated Sportfolio widget shell and immutable lazy chunks. Do not re-inline all view code into multiple duplicated resources.
- Preserve existing presentation feature flags, OAuth/public access policy, staged-action confirmation model, tool bindings, and sanitization restrictions.
- Do not broaden capabilities or expose internal/admin tools.
- Keep both legacy personal-token MCP behavior and public ChatGPT/plugin protocol compatibility intact.

## Validation / acceptance

Run the relevant focused suites plus the repository's standard validation/build commands used by CI. At minimum include TypeScript checking, plugin UI build, presentation/resource tests, MCP protocol/discovery smoke tests, and privacy tests.

Acceptance criteria:
- no `unrecognized_keys` from composed renderer calls;
- no tool advertises stale semantic UI URI as its active resource/template;
- no resource/template lookup failures;
- no widget CSP asset failures introduced;
- no raw IDs displayed as player names;
- optional child failures are visibly modeled as unavailable, not empty;
- no sensitive OpenAI/session/subject/auth header values in logs;
- all relevant tests and build checks pass;
- no unrelated repository changes.

## Implementation report

Before finishing, create `.factory-implementation-report.md` summarizing changed files, exact tests run, and any compatibility aliases retained. The workflow will remove the report/task contract before committing; it is for execution verification only.