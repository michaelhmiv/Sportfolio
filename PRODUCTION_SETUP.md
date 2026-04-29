# Production Cron Jobs Setup Guide

This guide explains how to set up external cron jobs for your published Sportfolio site using cron-job.org (free service).

## Why External Cron Jobs?

Railway deployments should run scheduled jobs via external triggers (or Railway scheduled jobs). This keeps production jobs running consistently even if app instances restart.

## Deployment Source Of Truth

Sportfolio deploys should be GitHub-first:

1. Push the intended change to GitHub.
2. Land it through the normal branch/PR flow.
3. Let Railway pick up the tracked GitHub branch deploy.

Do not use direct local `railway up` deploys as the normal release path. Production should always map back to a GitHub commit that reviewers can inspect.

## Required Background Jobs

Your Sportfolio app requires these automated jobs:

1. **schedule_sync** - Updates game schedules and slate readiness
2. **stats_sync** - Syncs completed game statistics
3. **stats_sync_live** - Syncs live in-progress statistics across supported sports
4. **roster_sync** - Updates NBA player roster
5. **sync_player_game_logs** - Caches player game logs with pre-calculated fantasy points (reduces API calls by ~95%)
6. **bot_engine** - Executes AMM bot scouting/trading/liquidity actions

For the full multi-sport job matrix, use `docs/CRON_JOBS.md` as the canonical reference.

## Setup Instructions

### Step 1: Get Your Admin API Token

1. Open your Railway project
2. Go to service Variables
3. Find `ADMIN_API_TOKEN` and copy its value
4. Save this somewhere secure - you'll need it for cron-job.org

### Step 2: Get Your Published Site URL

Your published site URL should be something like:

```
https://your-domain.com
```

Find this in your Railway service settings.

### Step 3: Create Account on cron-job.org

1. Go to https://cron-job.org
2. Sign up for a free account
3. Verify your email

### Step 4: Create Cron Jobs

For each job below, create a new cron job in cron-job.org:

#### Job 1: Schedule Sync (Every Minute)

- **Title:** Sportfolio - Schedule Sync
- **URL:** `https://your-domain.com/api/admin/jobs/trigger`
- **Schedule:** Every minute
  - Use cron expression: `* * * * *`
- **Request Method:** POST
- **Request Body:**
  ```json
  { "jobName": "schedule_sync" }
  ```
- **Headers:**
  - Name: `Content-Type`, Value: `application/json`
  - Name: `Authorization`, Value: `Bearer YOUR_ADMIN_API_TOKEN`

#### Job 2: Stats Sync (Every Hour)

- **Title:** Sportfolio - Stats Sync
- **URL:** `https://your-domain.com/api/admin/jobs/trigger`
- **Schedule:** Every hour
  - Use cron expression: `0 * * * *`
- **Request Method:** POST
- **Request Body:**
  ```json
  { "jobName": "stats_sync" }
  ```
- **Headers:**
  - Name: `Content-Type`, Value: `application/json`
  - Name: `Authorization`, Value: `Bearer YOUR_ADMIN_API_TOKEN`

#### Job 3: Live Stats Sync (Every 5 Minutes)

- **Title:** Sportfolio - Live Stats Sync
- **URL:** `https://your-domain.com/api/admin/jobs/trigger`
- **Schedule:** Every 5 minutes
  - Use cron expression: `*/5 * * * *`
- **Request Method:** POST
- **Request Body:**
  ```json
  { "jobName": "stats_sync_live" }
  ```
- **Headers:**
  - Name: `Content-Type`, Value: `application/json`
  - Name: `Authorization`, Value: `Bearer YOUR_ADMIN_API_TOKEN`

#### Job 4: Roster Sync (Daily at 5 AM UTC)

- **Title:** Sportfolio - Roster Sync
- **URL:** `https://your-domain.com/api/admin/jobs/trigger`
- **Schedule:** Daily at 05:00 (5 AM UTC)
  - Use cron expression: `0 5 * * *`
- **Request Method:** POST
- **Request Body:**
  ```json
  { "jobName": "roster_sync" }
  ```
- **Headers:**
  - Name: `Content-Type`, Value: `application/json`
  - Name: `Authorization`, Value: `Bearer YOUR_ADMIN_API_TOKEN`

#### Job 5: Player Game Logs Sync (Daily at 6 AM ET)

- **Title:** Sportfolio - Sync Player Game Logs
- **URL:** `https://your-domain.com/api/admin/jobs/trigger`
- **Schedule:** Daily at 06:00 AM Eastern Time (11:00 UTC during DST, 10:00 UTC otherwise)
  - Use cron expression: `0 10 * * *` (adjust for your timezone)
- **Request Method:** POST
- **Request Body:**
  ```json
  { "jobName": "sync_player_game_logs" }
  ```
- **Headers:**
  - Name: `Content-Type`, Value: `application/json`
  - Name: `Authorization`, Value: `Bearer YOUR_ADMIN_API_TOKEN`
- **Notes:**
  - This job caches all player game logs with pre-calculated fantasy points
  - Reduces MySportsFeeds API calls by ~95%
  - First run will backfill entire season (~15 minutes)
  - Uses conservative rate limiting (150 req/5min, 2s delay between players)

#### Job 6: Bot Engine (Every 15 Minutes)

- **Title:** Sportfolio - Bot Engine
- **URL:** `https://your-domain.com/api/admin/jobs/trigger`
- **Schedule:** Every 15 minutes
  - Use cron expression: `*/15 * * * *`
- **Request Method:** POST
- **Request Body:**
  ```json
  { "jobName": "bot_engine" }
  ```
- **Headers:**
  - Name: `Content-Type`, Value: `application/json`
  - Name: `Authorization`, Value: `Bearer YOUR_ADMIN_API_TOKEN`

### Step 5: Test Your Setup

1. Manually run one of the cron jobs in cron-job.org
2. Check the execution history - it should show HTTP 200 response
3. Visit `/admin` on your site to verify the job ran successfully

### Step 6: Monitor Your Jobs

- cron-job.org provides execution logs showing success/failure
- You can also check `/admin` page on your site to see last job runs
- Failed jobs will show up as errors in cron-job.org

## Android Rewarded Scout Boost (AdMob)

If you are shipping the Android rewarded scout boost flow, configure these production variables on the live Railway service before publishing a build:

- `ADSENSE_PUBLISHER_ID`
- `ADMOB_APP_ID_ANDROID`
- `ADMOB_REWARDED_SCOUT_AD_UNIT_ID`
- `REWARDED_SCOUT_BOOST_SECRET`

Current production values for the Sportfolio Android app are:

- App ID: `ca-app-pub-2708638041809482~8217225961`
- Rewarded ad unit: `ca-app-pub-2708638041809482/7806162422`
- AdSense publisher ID: `pub-2708638041809482`

The backend is already wired to verify AdMob server-side reward callbacks at:

```text
https://www.sportfolio.market/api/mobile/rewarded-scout-boost/admob/ssv
```

AdMob console setup notes:

1. Use the Android app ID above in the Google Mobile Ads SDK quick-start configuration for the Android manifest.
2. Use the rewarded ad unit above for the Android scout boost placement.
3. In AdMob server-side verification settings for that rewarded unit, point the callback at the Sportfolio URL above.
4. Keep Google test rewarded units enabled for local emulator/device QA until you are validating against production inventory.

Operational notes:

- `ADSENSE_PUBLISHER_ID` is served from `/ads.txt` so AdSense and Ad Manager crawlers can verify the Sportfolio seller record directly.
- `ADMOB_APP_ID_ANDROID` is needed by the native Android build.
- `ADMOB_REWARDED_SCOUT_AD_UNIT_ID` is served dynamically by `/api/mobile/rewarded-scout-boost/session`.
- `REWARDED_SCOUT_BOOST_SECRET` signs the `custom_data` payload that the backend later verifies when AdMob calls the SSV route.
- Because Android now contains rewarded ads, remember to declare `Contains ads` accurately in the Play Console listing.

## Manual Trigger via Admin Panel

Admin users can access the admin panel for manual job triggers and system monitoring:

1. Log into your Sportfolio site as an admin user
2. Visit your profile page
3. Click the "Admin" button (only visible to admin users)
4. View system stats and use job trigger buttons to run jobs manually

**Security Model:**

- Admin panel access requires the `isAdmin` flag to be set to `true` in the users table
- External cron jobs use token-based authentication (`ADMIN_API_TOKEN`) for secure automated access
- To grant admin access to a user, run: `UPDATE users SET is_admin = true WHERE id = 'user_id';`

## Troubleshooting

### Job Returns 401 Unauthorized

**For external cron jobs:**

- Check that your `ADMIN_API_TOKEN` is correct in the Authorization header
- Make sure you included "Bearer " prefix in the header value

**For admin panel access:**

- Ensure you're logged in to the application
- Verify your user has `is_admin = true` in the database
- To grant admin access: `UPDATE users SET is_admin = true WHERE id = 'user_id';`

### Job Returns 503 Service Unavailable

- Your `ADMIN_API_TOKEN` variable is missing in Railway
- Add it in Railway Variables and redeploy

### Live Stats Not Updating

- Make sure `stats_sync_live` is running every 5 minutes
- Check job execution logs in cron-job.org for errors
- Verify your upstream sports API credentials are still valid

### Games Not Updating

- Make sure `schedule_sync` job is running every minute
- Check job execution logs in cron-job.org for errors

## Cost

cron-job.org is completely free for up to 50 cron jobs. Sportfolio currently uses 6 in this baseline setup, so you're well within the limits.

## Security

Your `ADMIN_API_TOKEN` acts as authentication for these endpoints. Keep it secure:

- Don't share it publicly
- Rotate it periodically (update in both Railway Variables and cron-job.org)
- Only use HTTPS URLs (your platform provides this automatically)
