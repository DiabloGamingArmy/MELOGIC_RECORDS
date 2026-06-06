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
