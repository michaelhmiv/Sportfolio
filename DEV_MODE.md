# Development Mode Bypass

## Overview

This app includes a development mode bypass that allows you to test the application without going through the OAuth login flow.

## How to Enable

The dev bypass is **automatically enabled by default** in development mode (`NODE_ENV=development`). No configuration needed!

## How It Works

When the dev bypass is active:

1. You don't need to log in - authentication is automatically bypassed
2. A mock user is created with the following credentials:
   - **User ID**: `dev-user-12345678`
   - **Email**: `dev@example.com`
   - **Name**: Dev User
   - **Starting Balance**: $10,000

3. The mock user is automatically created in the database if it doesn't exist
4. All authenticated features work normally with this mock user

## Security

**Important:** This bypass only works when:

- `NODE_ENV=development` (development mode)
- `DEV_BYPASS_AUTH=true` is set

It will **never** work in production, ensuring your production app remains secure.

## Disabling the Bypass

If you want to test the real OAuth flow in development:

1. Set the environment variable `DEV_BYPASS_AUTH=false`

2. Restart the server

3. Make sure your OAuth application has your development callback URL registered

## Troubleshooting

If you still see login errors after enabling the dev bypass, you may have an old session cookie that's causing issues. To fix:

1. Clear your browser cookies for this site
2. Or use an incognito/private browsing window
3. Refresh the page - you should be automatically logged in as the dev user

## Logs

When the dev bypass is active, you'll see this message in the console:

```
[DEV_BYPASS] Dev mode auth bypass active - using mock user
```

## Normal OAuth Flow

To test the normal OAuth flow in production:

1. The app is published at your production domain
2. OAuth callback URLs must be registered in your identity provider settings
3. Users log in with their real accounts

---

## GitHub CLI Access for Private Repositories

### Important: GitHub CLI is Per-Instance

GitHub CLI (`gh`) is a **system-level tool** that must be installed separately for each:

- Claude Code instance/environment
- Development machine
- CI/CD pipeline

It is **not** automatically shared across different instances.

### What Happens Without GitHub CLI

Claude Code cannot:

- View GitHub issues via CLI (`gh issue view`)
- Access private repository content programmatically
- Run GitHub API commands directly (`gh api`)

### Installation

Download GitHub CLI from: https://cli.github.com/

- **Windows**: `winget install GitHub.cli` or download installer
- **macOS**: `brew install gh`
- **Linux**: `apt install gh` or your distro's package manager

### Workarounds (Without GitHub CLI)

1. **WebFetch**: Can access public GitHub URLs (but not private issues)
2. **User Provides Details**: Share issue text/URLs directly with Claude Code
