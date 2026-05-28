# Apple Publish Readiness v1 Workplan Handoff

Last updated: 2026-05-28  
Repo: `C:\Users\micha\.codex\worktrees\a587\Sportfolio-Replit`  
Current git state: detached `HEAD` with uncommitted iOS publish-readiness changes

## 1. Decision-Locked Launch Scope

1. iPhone only (`TARGETED_DEVICE_FAMILY = 1`)
2. US-first storefront
3. Paid premium purchases disabled on iOS v1
4. Rewarded AdMob scout boost required on iOS (non-personalized ads)
5. In-app account deletion initiation required
6. Sign in with Apple required

## 2. What Has Already Been Implemented

### 2.1 Code implementation completed

1. iPhone-only target change in iOS project:
   - `mobile/ios/App/App.xcodeproj/project.pbxproj`
2. Sign in with Apple client flow added:
   - `client/src/hooks/useAuth.tsx`
   - `client/src/pages/Login.tsx`
   - telemetry allowlist in `server/supabaseAuth.ts`
3. In-app account deletion backend + wiring:
   - `server/routes/account-deletion.ts` (`request`, `status`, `cancel`)
   - route registration in `server/routes/register-domain-routes.ts`
   - startup schema ensure in `server/routes.ts`
   - processor startup in `server/index.ts`
4. Account deletion UI replaced (email fallback only):
   - `client/src/pages/account-deletion.tsx`
5. Rewarded scout boost refactor to platform-neutral adapter:
   - `client/src/lib/native-rewarded-ads.ts`
   - `client/src/hooks/use-rewarded-scout-boost.ts`
   - related UI updates in premium/scout surfaces
6. iOS rewarded ads plugin scaffold added:
   - `mobile/ios/App/App/IOSRewardedAdsPlugin.swift`
   - iOS project + plist updates for AdMob app ID and SKAdNetwork entries
7. Android rewarded requests updated for non-personalized mode support:
   - `mobile/android/app/src/main/java/com/sportfolio/app/AndroidRewardedAdsPlugin.java`
8. iOS premium external checkout blocks preserved:
   - existing backend blocking routes remain in place
9. Targeted tests added/updated:
   - `client/src/hooks/useAuth.test.ts`
   - `server/routes/account-deletion.test.ts`
   - `client/src/lib/native-rewarded-ads.test.ts`
   - updated rewarded hook tests

### 2.2 Documentation/checklist created

1. `docs/ios-publish-readiness-v1-checklist.md`
2. `tasks/todo.md` section `2026-05-28 Apple Publish Readiness (iPhone-US v1)`

## 3. What Is Still Not Done

### 3.1 Local validation is still pending

`npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check` have not completed in this worktree because `node_modules` tool binaries are missing.

### 3.2 Release hardening/verification still pending

1. End-to-end behavior verification on iOS simulator/device for:
   - Apple sign-in success/failure/cancel
   - account deletion request/status/cancel
   - rewarded ad load/show/reward credit path
   - iOS premium purchase lock/no bypass
2. TestFlight upload path for new changes has not been rerun yet.
3. App Store listing workflow should be rerun on latest `main` after merge.

### 3.3 Portal-side tasks still pending (cannot be done purely in repo)

1. Apple Developer capability and key confirmation for Sign in with Apple
2. Supabase Apple provider enablement and callback verification
3. AdMob iOS app/ad-unit and SSV verification setup confirmation
4. App Store Connect privacy/accessibility/age-rating/review-note completion

## 4. Ownership Matrix

### Can be done by the next coding agent

1. Branching, dependency install, lint/type/test/format fixes
2. Additional code fixes for iOS plugin/adapter if validation fails
3. Commit/PR creation
4. Triggering GitHub Actions workflows (`iOS App Store Listing`, `iOS TestFlight`) once merged

### Requires human/operator portal access

1. Apple Developer portal capability/key setup checks
2. Supabase Auth provider dashboard changes
3. AdMob console configuration
4. App Store Connect policy forms and final submission click-through

## 5. Execution Plan (Step-by-Step)

## Phase A: Stabilize branch and workspace

1. Create a named branch from current detached `HEAD` (do not lose local changes).
2. Confirm all intended files are present via `git status -sb`.
3. Run `npm ci` to install dependencies.

Exit criteria:

1. On a normal branch (not detached).
2. `node_modules` binaries available (`tsc`, `eslint`, `vitest`, `prettier`).

## Phase B: Validate and fix code

1. Run:
   - `npm run check`
   - `npm run lint`
   - `npm run test:run`
   - `npm run format:check`
2. Fix failures and rerun all four commands until green.
3. If failures are pre-existing/unrelated, document exact file/test signatures in PR notes.

Exit criteria:

1. All commands pass, or remaining failures are clearly proven pre-existing.

## Phase C: iOS functional verification (code-level)

1. Verify Apple login button appears in login surfaces (native + web).
2. Verify account deletion page is in-app workflow first (not email-first).
3. Verify rewarded boost entry points are available on iOS and use native adapter path.
4. Verify iOS purchase CTAs cannot trigger external paid checkout.
5. Verify iOS project still builds after `IOSRewardedAdsPlugin.swift` and project plist changes.

Exit criteria:

1. No regressions on auth/deletion/rewarded/premium-lock flows.

## Phase D: Merge and release pipeline

1. Commit with clear scope.
2. Push branch and open PR.
3. Merge to `main` after review.
4. Trigger workflow `iOS App Store Listing` on `main` and confirm success.
5. Trigger workflow `iOS TestFlight` with:
   - first run: `skip_upload=true`
   - second run: `skip_upload=false`
6. Confirm TestFlight processing completes for uploaded build.

Exit criteria:

1. Listing workflow succeeded on latest `main`.
2. TestFlight upload succeeded for latest `main`.

## Phase E: Portal finalization and App Review submission

1. Apple Developer:
   - confirm Sign in with Apple capability is enabled on app ID
   - confirm keys/certs/profiles valid
2. Supabase Auth:
   - Apple provider enabled
   - callbacks include `sportfolio://auth/callback` and web callback
3. AdMob:
   - iOS app and rewarded ad unit configured
   - SSV target verified with existing backend endpoint
   - non-personalized ad mode confirmed
4. App Store Connect:
   - US-only availability
   - privacy + accessibility + age rating sections complete
   - reviewer test credentials and explicit test steps provided
5. Submit approved TestFlight build to App Review.

Exit criteria:

1. All App Store Connect required sections are complete and saved.
2. Build submitted to review with accurate notes.

## 6. Suggested Command Runbook for Next Agent

1. `git checkout -b codex/apple-publish-readiness-v1`
2. `npm ci`
3. `npm run check`
4. `npm run lint`
5. `npm run test:run`
6. `npm run format:check`
7. `git status -sb`
8. `git add -A`
9. `git commit -m "Finalize Apple publish readiness v1 (iPhone-US)"`
10. `git push -u origin codex/apple-publish-readiness-v1`

After merge to `main`:

1. `gh workflow run "iOS App Store Listing" --ref main`
2. `gh workflow run "iOS TestFlight" --ref main -f skip_upload=true -f cap_server_url=https://www.sportfolio.market`
3. `gh workflow run "iOS TestFlight" --ref main -f skip_upload=false -f cap_server_url=https://www.sportfolio.market`

## 7. Acceptance Criteria (Definition of Done)

1. iOS binary is iPhone-only.
2. Apple sign-in works and is visible in app login.
3. Account deletion can be initiated in-app by authenticated users.
4. iOS rewarded scout boost works with non-personalized AdMob requests.
5. iOS premium paid checkout remains blocked with no bypass path.
6. Required validation commands pass on merged code.
7. App Store listing sync and TestFlight upload both succeed from `main`.
8. App Store Connect metadata/policy forms are complete and submission is sent.

## 8. Risks and Watch Items

1. iOS native plugin compile/runtime mismatch (needs Xcode/TestFlight verification).
2. Missing or stale portal config can break Apple OAuth or AdMob delivery despite correct code.
3. Detached-head local state can lose work if branching is not done first.
4. Workflow failures may occur from external App Store Connect metadata conflicts; inspect failed run logs before changing code.

## 9. Primary Reference Files

1. `docs/ios-publish-readiness-v1-checklist.md`
2. `tasks/todo.md` (2026-05-28 section)
3. `docs/ios-github-actions-rollout.md`
4. `mobile/README.md`

