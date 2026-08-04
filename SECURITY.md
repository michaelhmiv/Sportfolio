# Security Policy

## Supported Version

Security fixes are applied to the current `main` branch and the production deployment derived from it. Older commits, forks, and unofficial deployments are not supported.

## Reporting a Vulnerability

Do not open a public issue for suspected vulnerabilities, exposed credentials, authentication bypasses, authorization failures, payment or entitlement flaws, account-takeover paths, or user-data exposure.

Use GitHub's private vulnerability reporting feature from the repository's **Security** tab. Include:

- the affected route, component, workflow, or commit;
- reproduction steps and required account state;
- the security impact and data or privileges at risk;
- logs, screenshots, or a minimal proof of concept with secrets redacted;
- any known mitigation.

If private vulnerability reporting is unavailable, contact the repository owner privately through the contact method shown on the owner's GitHub profile. Do not transmit live credentials or personal user data.

## Credential Exposure

Treat every credential committed to Git history as compromised, even if it is later deleted. Immediately revoke or rotate it at the provider, review access logs, invalidate dependent sessions where applicable, and then remove it from current files and Git history.

## Public Security Boundaries

The following values may be intentionally public and are not authentication secrets by themselves: Supabase project URLs, Supabase anonymous keys, OAuth issuer and JWKS URLs, AdMob application or ad-unit identifiers, and public site URLs. Service-role keys, database credentials, signing keys, webhook URLs, API tokens, refresh tokens, private OAuth client secrets, and service-account JSON are always confidential.

## Scope

Reports should focus on the Sportfolio code and production services. Do not perform denial-of-service testing, social engineering, physical attacks, destructive data modification, broad automated scanning against production, or access to another user's data beyond the minimum needed to demonstrate the issue.
