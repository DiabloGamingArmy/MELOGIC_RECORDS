# Email Operations Runbook

## Configure Secrets

Codex must not run these commands. The project owner runs them manually:

```bash
firebase functions:secrets:set SMTP_HOST --project melogic-records
firebase functions:secrets:set SMTP_PORT --project melogic-records
firebase functions:secrets:set SMTP_USER --project melogic-records
firebase functions:secrets:set SMTP_PASS --project melogic-records
firebase functions:secrets:set EMAIL_FROM --project melogic-records
```

Typical sender identity:

- SMTP user: `support@melogicrecords.studio`
- From: `Melogic Records Support <support@melogicrecords.studio>`
- Reply-To: `support@melogicrecords.studio`

## Rotate SMTP Credentials

1. Create a new Google Workspace app password or SMTP relay credential.
2. Run `firebase functions:secrets:set SMTP_PASS --project melogic-records`.
3. Redeploy affected email/auth functions.
4. Send a test email to self from Admin Settings.
5. Revoke the old credential in Google Workspace.

## Disable Sending Quickly

If the mailbox or credential is compromised, revoke the Google Workspace app password or relay credential. Email functions will fail closed and record redacted failures instead of exposing secrets.

## Check Failures

Open Admin Settings -> Email. Review:

- Provider configured status;
- Last success;
- Last failure;
- Recent failure count;
- Recent Email Logs;
- Recent Failures.

Failures are redacted. Do not paste real SMTP passwords or app passwords into support tickets, logs, docs, or source files.

## Test Auth Emails

1. Request password reset from `/auth`.
2. Request verification from `/account/security`.
3. Use Admin Account Hub -> Send Reset for a test account.
4. Confirm emailLogs and adminLogs entries exist.
5. Confirm messages come from `support@melogicrecords.studio`.

## Abuse Controls

Admin email has backend rate limits:

- 10 sends per admin per 10 minutes;
- 50 sends globally per hour;
- 5 sends per recipient per hour.

Rate-limited attempts write `admin_email_rate_limited`.

## Scope Warning

This system is for transactional/support/security email only. Newsletter, marketing, and bulk announcements require unsubscribe/compliance tooling and are out of scope.
