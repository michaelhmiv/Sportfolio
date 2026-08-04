# Public capability governance

The reviewed baseline is `config/public-capability-snapshot.json`. It records every public tool, prompt, and resource; authentication mode; read-only, destructive, and open-world annotations; output-schema identifier; UI resource binding; domain; and sport classification.

`npm run governance:capabilities` compares the runtime catalog with the baseline and scans bounded registration, scheduler, route, navigation, and production build surfaces. It fails for additions, removals, metadata changes, OAuth-to-public downgrades, missing output schemas, raw provider prefixes, retired capabilities, expired exceptions, or exception-budget growth. There is no environment-variable bypass.

Intentional changes require `npm run governance:capabilities:update`, review of the human-readable diff, and committing the baseline in the same PR. Exceptions require an owner, reason, expiration date, bounded paths, and maximum match count. Server-only legacy exceptions expire September 30, 2026; client source and client build artifacts have no exceptions.

Sample drift report:

```text
Public capability snapshot diff:
  Added: tool:get_new_surface
  Removed: none
  Changed: tool:get_player_detail[auth,outputSchema]
  AUTH DOWNGRADES: tool:get_player_detail
```

Remediation: remove unintended registration or lazy route code; restore metadata; or explicitly update and review the baseline. Rollback is a single PR revert.

The checker, reviewed snapshot, policy, and tests are merged independently of trusted workflow changes. Plugin Readiness integration must be added afterward in a minimal workflow-only pull request from the latest `main`, then proven through exact-head release and security checks.
