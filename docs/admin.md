# Admin Security Visibility

Admin Account Hub displays account-security state from safe sources:

- Firebase Auth email verified status;
- Firebase Auth MFA enabled/factor count;
- Auth provider IDs;
- last Firebase Auth sign-in timestamp;
- recent `users/{uid}/accountEvents` entries;
- account status and admin role status.

Admin UI must not show TOTP secrets, recovery codes, password reset links, refresh tokens, SMTP credentials, or any other secret material.

Current phase does not allow admins to disable another user’s 2FA. Future owner-only recovery tooling must require reason logging and write `adminLogs`.

## Email Operations

Admin Settings includes Email provider status, Compose Email, recent logs, and recent failures. Sending requires `emailSend`.

Admin Account Hub includes user-specific email actions:

- Email User, which opens the Admin Email composer with the recipient and related UID prefilled;
- Send Password Reset;
- Send Email Verification for unverified email accounts;
- Send Security Notice.

Each backend send writes `emailLogs` and `adminLogs`. Full email bodies are not mirrored into `adminLogs`; logs use domains, related IDs, status, provider message IDs, hashes/previews, and redacted error fields.
