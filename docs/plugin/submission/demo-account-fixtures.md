# Demo reviewer account fixture

Create one dedicated, synthetic Sportfolio reviewer account before submission. Credentials belong only in the OpenAI submission portal.

## Identity and access

- Synthetic display name: `OpenAI Reviewer`
- Non-personal reviewer email owned by Sportfolio
- Strong unique password stored in the organization's approved password manager
- Email confirmed before submission so there is no email-confirmation requirement during review
- MFA disabled for this account only, with no MFA requirement during review
- No phone number, SMS link, or SMS requirement during review
- No admin, moderation, bot, or staff privileges
- No payment method or premium purchase history required

## Deterministic gameplay state

The account must contain:

- At least eight MLB player holdings across at least three teams
- Holdings with varied share counts and virtual position values
- A non-zero virtual balance
- At least one watchlist containing four or more players
- A partially completed Yankees collection
- At least one additional partially completed collection
- Multiple achieved and incomplete milestones
- Prior daily-boost history with both positive and negative virtual outcomes
- At least three currently eligible owned players for boost-candidate analysis

Do not require a live game to reproduce the five mandatory positive cases. Personalized game-schedule prompts may be supplemental and can reflect current live data.

## Reset requirements

Before submission and after any reviewer-support intervention:

1. Confirm the account can sign in without additional verification.
2. Revoke existing OAuth grants so the initial connection flow is reproducible.
3. Restore the required holdings, watchlist, collection progress, milestone state, and boost history.
4. Confirm no personal user data has been copied into the fixture.
5. Run all positive and negative test cases in fresh conversations.

## Prohibited handling

- Never commit the email or password.
- Never place credentials in GitHub Actions logs or artifacts.
- Never use a real customer account.
- Never use an admin account.
- Never require the reviewer to contact support merely to sign in.
