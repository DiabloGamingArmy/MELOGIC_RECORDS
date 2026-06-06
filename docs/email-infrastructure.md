# Email Infrastructure

Phase 1 uses Google Workspace SMTP for `support@melogicrecords.studio`.

## Provider

- Sender: `Melogic Records Support <support@melogicrecords.studio>`
- Reply-To: `support@melogicrecords.studio`
- Backend only: Firebase Functions read SMTP credentials from Secret Manager.
- Frontend code never receives SMTP credentials, app passwords, OAuth tokens, or Gmail secrets.

## Required Secrets

Set real values locally through the Firebase CLI. Do not commit them.

```bash
firebase functions:secrets:set SMTP_HOST --project melogic-records
firebase functions:secrets:set SMTP_PORT --project melogic-records
firebase functions:secrets:set SMTP_USER --project melogic-records
firebase functions:secrets:set SMTP_PASS --project melogic-records
firebase functions:secrets:set EMAIL_FROM --project melogic-records
```

Expected values are usually:

- `SMTP_HOST`: Google Workspace SMTP host or relay host.
- `SMTP_PORT`: `587` for STARTTLS or `465` for TLS.
- `SMTP_USER`: `support@melogicrecords.studio`.
- `SMTP_PASS`: Google Workspace app password or relay credential.
- `EMAIL_FROM`: `Melogic Records Support <support@melogicrecords.studio>`.

## Google Workspace Setup

1. Confirm `support@melogicrecords.studio` exists in Google Workspace.
2. Enable 2-Step Verification for the mailbox if using an app password.
3. Create a mailbox app password or configure Workspace SMTP relay.
4. Add the Firebase Functions secrets above.
5. Deploy functions that bind the email secrets.
6. Test with Admin Settings -> Email -> Send Test to Self.

## Functions

- `requestPasswordResetEmail`: public callable; generates Firebase password reset links with Admin SDK and sends through support SMTP. It always returns a generic success response when the account does not exist.
- `requestEmailVerification`: authenticated callable; sends verification only to the current Firebase Auth user's email.
- `sendAdminEmail`: admin callable; requires `emailSend`, validates/sanitizes input, sends support email, writes `emailLogs`, and writes `adminLogs`.
- `getEmailAdminStatus`: admin callable; shows provider status and recent email logs without exposing secrets.

## Logs

Email attempts are recorded in `emailLogs/{emailId}` with recipient, recipient domain, category, status, provider, provider message id, related IDs, and redacted errors. Clients cannot write email logs directly.

Security/account email helpers write `users/{uid}/accountEvents/{eventId}` with optional email delivery fields. Full IPs are not stored; callers should prefer hashed or summarized network data.

## Rotation / Disable

To rotate credentials:

1. Create a new Google Workspace app password or relay credential.
2. Run `firebase functions:secrets:set SMTP_PASS --project melogic-records`.
3. Redeploy affected functions.
4. Revoke the old credential in Google Workspace.

To disable sending quickly, revoke the Workspace credential or remove/rotate `SMTP_PASS`. Functions will report provider/send failures without exposing the secret.

## 2FA Direction

Email confirmation is not used as primary 2FA. Authenticator-app/TOTP enrollment is handled through Firebase Auth in `/account/security`; the TOTP secret stays in browser memory during setup and is not written to Firestore or Functions.

Recovery codes remain a future hardening phase and must store only hashed codes server-side when implemented.
