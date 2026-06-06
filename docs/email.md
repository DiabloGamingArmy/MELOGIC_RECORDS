# Email

Phase 1 created the backend email sender for `support@melogicrecords.studio`. Phase 2 adds security notification usage for account-security events such as enabling and disabling authenticator-app 2FA.

## Secret Handling

Codex must not run secret-setting commands. The owner must run these manually when SMTP is ready:

```bash
firebase functions:secrets:set SMTP_HOST --project melogic-records
firebase functions:secrets:set SMTP_PORT --project melogic-records
firebase functions:secrets:set SMTP_USER --project melogic-records
firebase functions:secrets:set SMTP_PASS --project melogic-records
firebase functions:secrets:set EMAIL_FROM --project melogic-records
```

No SMTP credentials, app passwords, OAuth tokens, or refresh tokens should be committed or exposed to frontend code.

## Missing Secrets

Email sender code reads Firebase Functions v2 secrets with `defineSecret`. Missing or unavailable SMTP configuration fails closed:

- email sends throw `email-provider-not-configured`;
- security actions such as TOTP enable/disable still complete if Firebase Auth succeeds;
- account events record `emailSkipped`, `emailSkipReason`, and redacted email errors;
- unrelated functions should not log or expose secret values.

## Security Notifications

Security emails are concise account notices with timestamp, action summary, and support guidance. They never include TOTP secrets, recovery codes, or password reset links except in the dedicated reset/verification email flows.

## Admin Email Operations

Admin custom email is sent through `sendAdminEmail` and requires the `emailSend` permission. Owner/admin role fallback may qualify according to the current admin-claims model, but non-admin users cannot send arbitrary email.

Admin email supports:

- plain-text body converted to escaped HTML;
- optional CC recipients;
- optional Reply-To, defaulting to `support@melogicrecords.studio`;
- categories: support, account, marketplace, moderation, order, security, payout, other;
- related user/product/order/report IDs;
- email log and admin audit log entries for sent, failed, and rate-limited attempts.

Marketing/newsletter sending is out of scope. Any bulk or marketing email feature must include unsubscribe/compliance handling before it is added.

## Email Logs

`emailLogs/{emailId}` records recipient, recipient domain, CC domains, subject, category, template name, status, sender admin UID/email, related IDs, provider, provider message ID, timestamps, redacted errors, body hash, and a short body preview. Full secret/provider errors and SMTP credentials are never stored.

Regular users cannot read or write email logs. Admins with `emailSend` or audit permissions can read through rules/callables. Backend code is the only writer.

## Rate Limits

Admin email sending uses transaction-backed Firestore counters:

- per admin: 10 emails per 10 minutes;
- global: 50 emails per hour;
- per recipient: 5 emails per hour.

Rate-limit failures return “Email rate limit reached. Try again later.” and write `admin_email_rate_limited` to `adminLogs`. No email is sent when a limit is exceeded.
