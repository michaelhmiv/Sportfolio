# MLB Collection Catalog Operations

This runbook covers the PR 3 MLB catalog lifecycle. All endpoints below require a valid authenticated session for a user whose `users.is_admin` value is `true`.

Publication and lifecycle mutations are content operations, not deployment steps. Preview first, inspect the exact source snapshot, and then submit the required confirmation token. Never edit finalized rows directly.

## Catalog contract

The initial manifest in `server/collections/mlb/initial-catalog.ts` contains:

- 15 finalized 2025 player-slot definitions;
- 7 tracking 2026 player-slot definitions;
- 3 finalized 2025 master definitions; and
- 9 version-pinned prerequisite links across the masters.

Player-slot counts can exceed a nominal top-ten cutoff because rank imports include ties. Threshold and official-award collections are source-sized. Every StatsAPI person must resolve to a canonical, tradeable Sportfolio player before a preview can pass.

### Source authority

| Content type          | StatsAPI source                       | Membership rule                                                    |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| Season leaders        | `/api/v1/stats`                       | Explicit hitting/pitching group, sort statistic, top ten plus ties |
| Qualified OPS/ERA     | `/api/v1/stats`                       | `playerPool=QUALIFIED`, top ten plus ties                          |
| Threshold clubs       | `/api/v1/stats`                       | Every imported player at or beyond the threshold                   |
| Postseason leaders    | `/api/v1/stats`                       | `gameType=P`, top ten plus ties                                    |
| Official awards/teams | `/api/v1/awards/{awardId}/recipients` | Exact official recipient IDs for the configured season             |

The stored source metadata includes an import timestamp, member count, and SHA-256 digest of the definition rule and resolved member payload. The hash is the operator confirmation boundary for membership-changing operations.

## Prerequisites

Before any mutation:

1. Deploy migrations `0049_collections_domain_v2.sql` and `0050_split_collection_pair_identity_triggers.sql`.
2. Confirm the operator exists in `users` with `is_admin = true`.
3. Confirm the application can reach `https://statsapi.mlb.com`.
4. Confirm each imported MLBAM ID resolves to an available canonical `players.id`.
5. Set an authenticated API base and bearer token in the operator shell:

```bash
export API_BASE='https://beta.sportfolio.market'
export ADMIN_TOKEN='<authenticated-admin-session-token>'
```

These examples use `curl`; they intentionally do not persist tokens or response bodies in the repository.

## Read-only inspection

### Inspect persisted catalog state

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_BASE/api/admin/collections/mlb/catalog"
```

Review each definition's lifecycle, current version, current version state, source metadata, active slot count, prerequisite count, and active collector count.

### Preview all source-backed definitions

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_BASE/api/admin/collections/mlb/catalog/preview"
```

A publishable preview has `ok: true` for every definition and no resolution, duplicate-player, or source-count errors.

### Preview one definition

```bash
SLUG='2026-mlb-home-run-leaders'
curl --fail-with-body \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_BASE/api/admin/collections/mlb/catalog/preview?slug=$SLUG"
```

Record the selected preview's `sourceSnapshot.sha256`. Refresh, finalization, and correction reject a hash that no longer matches a newly fetched preview. For initial publication, preview the entire catalog without `slug` and record the response-level `catalogSha256`; it commits to every ordered definition and source snapshot.

### Inspect participation before a disruptive operation

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_BASE/api/admin/collections/$SLUG/participation"
```

The report separates current-version participants, active collectors, active allocating users/quantity, and historical completers across every immutable version of the logical definition.

## Initial publication

Initial publication is atomic and fail-closed. It refuses a failed preview and refuses a partial pre-existing catalog. Published definitions are never hard-deleted by the API.

```bash
CATALOG_SHA256='<64-character catalogSha256 from the full preview response>'
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"confirm\":\"PUBLISH_INITIAL_MLB_CATALOG\",\"catalogSha256\":\"$CATALOG_SHA256\"}" \
  "$API_BASE/api/admin/collections/mlb/catalog/publish"
```

Expected first-run result: `status: "published"`, 25 definitions, 25 version-1 rows, source-sized slots, and 9 prerequisites. A complete retry returns `status: "already_published"` only after the current pointers, lifecycle states, source hashes, source-sized slot membership, and version-pinned prerequisite links match the confirmed manifest. Any mismatch is a partial-publication error requiring investigation, not an instruction to fill missing rows manually.

After publication, rerun catalog inspection and verify:

- 18 definitions are final, including the 3 masters;
- 7 definitions are tracking;
- every final version has finalization and membership-lock timestamps;
- every tracking version remains mutable only through the refresh workflow; and
- the three masters point to exact prerequisite version IDs.

## Tracking refresh

A tracking refresh may release allocations. Preview immediately before the operation, review membership and participation impact, then submit that exact source hash.

```bash
SOURCE_SHA256='<64-character hash from the selected preview>'
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"confirm\":\"REFRESH_MLB_COLLECTION\",\"sourceSha256\":\"$SOURCE_SHA256\"}" \
  "$API_BASE/api/admin/collections/$SLUG/refresh"
```

The transaction acquires affected-user advisory locks in deterministic order, preserves unchanged slot IDs, marks removed slots as removed, releases allocations for removed/replaced requirements, and deletes only the matching `collection` holdings locks. Shares are never redirected to replacement players. Affected state/parent reconciliation and durable `membership_changed` events commit atomically with the membership change; websocket delivery occurs only after commit and is best-effort.

Review `added`, `removed`, `replaced`, `releasedAllocations`, reconciliation counts, and `membershipEvents` in the response. A zero-change refresh is safe and should not schedule participants solely because source metadata was refreshed.

## Finalizing tracking membership

Finalization is irreversible for that version. It fetches and validates the selected preview, refreshes against it, reconciles affected users, then locks the same source hash as final.

```bash
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"confirm\":\"FINALIZE_MLB_COLLECTION\",\"sourceSha256\":\"$SOURCE_SHA256\"}" \
  "$API_BASE/api/admin/collections/$SLUG/finalize"
```

If the source hash changed, stop and review a new preview. Do not replace the hash blindly. After success, verify the definition and current version are final and that direct slot/prerequisite mutation is rejected by the database immutability triggers.

## Correcting finalized membership

Never modify a finalized version. A correction creates a new final immutable version linked by `correction_of_version_id`, advances `current_version`, releases active allocations from the replaced version, reconciles affected users, and preserves awards on the version originally completed. Repeating the same confirmed source hash after that correction is idempotent and returns the existing current correction instead of creating another version.

Preview first, inspect participation, and use a specific audit reason:

```bash
CORRECTION_REASON='Official source corrected the published player assignment'
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"confirm\":\"CREATE_MLB_CORRECTION_VERSION\",\"sourceSha256\":\"$SOURCE_SHA256\",\"reason\":\"$CORRECTION_REASON\"}" \
  "$API_BASE/api/admin/collections/$SLUG/correct"
```

After success, verify:

- `current_version` advanced by exactly one;
- the new version is final and points to the former current version;
- old active allocations are released and their collection locks are gone;
- old awards still point to the historical completed version; and
- participation reports historical completers across the full logical definition.

Allocations are intentionally not migrated to corrected membership, even when a player appears in both versions. Users explicitly allocate against the new immutable version.

If the corrected definition is a prerequisite of a master, correct each affected master afterward in bottom-up dependency order. The master correction may legitimately reuse the same catalog source hash: the repository compares its immutable prerequisite links with each prerequisite definition's current version and creates a new master version only when those links are stale. Repeat through ancestor masters until every current master version links to current prerequisite versions.

## Soft-disable

Disable removes a definition from active product resolution without deleting its history. It requires a confirmation token, audit reason, expected current version, and the persisted source hash for that current version from catalog inspection. Do not substitute a fresh upstream preview hash: upstream drift does not change the persisted disable precondition.

```bash
EXPECTED_VERSION='<current version from catalog inspection>'
SOURCE_SHA256='<persisted current-version source_metadata.sha256 from catalog inspection>'
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"confirm\":\"DISABLE_COLLECTION\",\"reason\":\"Official source is under review; definition disabled pending correction\",\"expectedVersion\":$EXPECTED_VERSION,\"sourceSha256\":\"$SOURCE_SHA256\"}" \
  "$API_BASE/api/admin/collections/$SLUG/disable"
```

Disabling atomically locks affected users, releases active allocations and their collection holdings locks, marks derived progress inactive, and appends durable membership events. It does not erase version, allocation, event, or award history. Confirm downstream catalog and identity reads filter the disabled logical definition as designed.

## Bounded safety reconciliation

Use bounded reconciliation to repair denormalized user state after a known interruption or operational incident. It is not the primary membership-refresh mechanism.

```bash
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"confirm":"RECONCILE_COLLECTION_STATES","limit":500}' \
  "$API_BASE/api/admin/collections/reconcile"
```

Review candidate, changed, error, and published-event counts. Repeat only after understanding whether the previous bounded run exhausted its candidate set.

## Failure handling

| Failure                                 | Required response                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Preview has any error                   | Do not mutate. Fix source shape, player resolution, or definition policy and preview again.             |
| Confirmed source hash changed           | Stop and compare the new preview; never approve a new hash without reviewing membership impact.         |
| Partial initial catalog detected        | Investigate the database state; do not hand-insert missing rows.                                        |
| Refresh releases unexpected allocations | Preserve the committed audit/event rows, disable if necessary, and correct via the supported lifecycle. |
| Finalized row rejects mutation          | Expected protection. Create a correction version instead.                                               |
| Reconciliation reports errors           | Inspect server logs and affected user/version candidates before retrying a bounded run.                 |
| Websocket publication fails             | The database event remains authoritative; clients recover through query invalidation/reload.            |

## Rollback boundaries

- Preview and inspect are read-only.
- Tracking refresh is not rolled back after commit; released shares remain available and must be explicitly reallocated.
- Finalization is not reversed. Any factual change uses a new correction version.
- Correction versions and historical awards are never deleted.
- Publication is soft-disabled rather than hard-deleted.
