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
