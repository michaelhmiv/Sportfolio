# Security Policy

## Supported version

Security fixes are applied to the current `main` branch and the production deployment derived from it. Older commits, forks, and unofficial deployments are not supported.

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities, exposed credentials, authentication bypasses, authorization failures, payment or entitlement flaws, account-takeover paths, or user-data exposure.

Use GitHub's private vulnerability reporting feature from the repository's **Security** tab. Include:

- the affected route, component, workflow, or commit;
- reproduction steps and required account state;
- the security impact and data or privileges at risk;
- logs, screenshots, or a minimal proof of concept with secrets redacted;
- any known mitigation.

If private vulnerability reporting is unavailable, contact the repository owner privately through the contact method shown on the owner's GitHub profile. Do not transmit live credentials or personal user data.

## Credential exposure

Treat every credential committed to Git history as compromised, even if it is later deleted. Immediately revoke or rotate it at the provider, review access logs, invalidate dependent sessions where applicable, and then remove it from current files and Git history.

## Current security boundaries

Sportfolio authentication uses Better Auth backed by Railway PostgreSQL. Resend is used for passwordless email delivery. ChatGPT/MCP authorization uses Better Auth OAuth/JWKS endpoints. Supabase authentication/runtime credentials, SMS/Telnyx authentication, and standalone provider sidecars are retired and must not be reintroduced as fallback mechanisms.

Values that may be intentionally public and are not secrets by themselves include public site URLs, OAuth issuer/discovery/JWKS URLs, and public advertising application/ad-unit identifiers. Database credentials, Better Auth secrets, webhook signing secrets, API tokens, refresh/access tokens, private OAuth client secrets, service-account JSON, and provider credentials are confidential.

## Scope

Reports should focus on Sportfolio code and production services. Do not perform denial-of-service testing, social engineering, physical attacks, destructive data modification, broad automated scanning against production, or access to another user's data beyond the minimum needed to demonstrate the issue.
