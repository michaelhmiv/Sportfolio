# Demo reviewer account fixture

Create one dedicated, synthetic Sportfolio reviewer account before submission. Credentials belong only in the OpenAI submission portal.

## Identity and access

- Synthetic display name: `OpenAI Reviewer`
- Non-personal reviewer email owned by Sportfolio
- Strong unique password stored in the organization's approved password manager
- Email confirmed before submission so there is no email-confirmation requirement during review
- MFA disabled for this account only, with no MFA requirement during review
- No phone-number verification requirement during review
- No admin, moderation, bot, or staff privileges
- No payment method or premium purchase history required

## Deterministic gameplay state

The account must contain:

- At least eight MLB player holdings across at least three teams
- An Aaron Judge holding or an account state where Aaron Judge is available for the market-buy test
- Holdings with varied share counts and virtual position values
- Enough virtual balance to complete the 25-Sportfolio-buck market-buy case after its preview
- No conflicting pending action before a reviewer test begins
- At least one existing watchlist containing four or more players
- No watchlist named `Review Targets` before the watchlist-management case
- A partially completed Yankees collection
- At least one additional partially completed collection
- Multiple achieved and incomplete milestones
- Prior daily-boost history with both positive and negative virtual outcomes
- At least one open daily-boost slot
- At least three currently eligible owned players for boost-candidate analysis
- At least one eligible player whose assignment can be safely reset after review

Do not require a live game to reproduce the five mandatory positive cases. Personalized game-schedule prompts may be supplemental and can reflect current live data.

## Action verification

For staged actions, record the starting virtual balance, holdings, and boost assignments before the test. Confirm that the staging call alone does not apply the gameplay action. After explicit confirmation, verify exactly one corresponding account change and no duplicate execution.

For the immediate watchlist case, verify that `Review Targets` is created once and Aaron Judge appears once. Delete that synthetic watchlist during reset.

## Reset requirements

Before submission and after any reviewer-support intervention:

1. Confirm the account can sign in without additional verification.
2. Revoke existing OAuth grants so the initial connection flow is reproducible.
3. Cancel or clear any pending gameplay transactions created during testing.
4. Restore the required holdings, virtual balance, collection progress, milestone state, and boost history.
5. Restore an open daily-boost slot and eligible candidate state.
6. Remove the `Review Targets` watchlist and restore the baseline existing watchlist.
7. Confirm no personal user data has been copied into the fixture.
8. Run all positive and negative test cases in fresh conversations.

## Prohibited handling

- Never commit the email or password.
- Never place credentials in GitHub Actions logs or artifacts.
- Never use a real customer account.
- Never use an admin account.
- Never require the reviewer to contact support merely to sign in.
