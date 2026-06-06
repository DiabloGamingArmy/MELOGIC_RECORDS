# Account Security

## Account Security Center

`/account/security` is the user-facing Account Security Center. It shows email verification status, password reset actions, authenticator-app 2FA status, connected sign-in providers, recovery-code status, and recent account/security events from `users/{uid}/accountEvents`.

Trusted events are written by backend callables. Clients can read their own events and mark them read, but cannot create or edit trusted event content directly.

## Authenticator App 2FA

Melogic uses Firebase Auth TOTP MFA through the Firebase Web SDK:

- `multiFactor(user).getSession()`
- `TotpMultiFactorGenerator.generateSecret(session)`
- `secret.generateQrCodeUrl(accountName, issuer)`
- `TotpMultiFactorGenerator.assertionForEnrollment(secret, code)`
- `multiFactor(user).enroll(assertion, 'Authenticator app')`
- `TotpMultiFactorGenerator.assertionForSignIn(enrollmentId, code)`
- `resolver.resolveSignIn(assertion)`
- `multiFactor(user).unenroll(factor)`

The TOTP secret is held only in browser memory during setup. It is not sent to Functions, not written to Firestore, and not logged. The setup key is only displayed during enrollment.

If Firebase Auth TOTP is not enabled for the project, setup shows a safe “Authenticator app 2FA is not configured yet” message. Enable TOTP MFA in Firebase Console under Authentication multi-factor settings before expecting enrollment to work in production.

## Reauthentication

Sensitive actions such as enabling or disabling TOTP may require recent login. The Account Security Center prompts for password reauthentication when the account has a password provider, or Google reauthentication when Google is the available provider. Passwords are not logged or stored.

## Security Events and Email

2FA enable/disable writes `users/{uid}/accountEvents` through `recordAccountSecurityEvent`. The callable attempts a security email through the Phase 1 email sender. If SMTP secrets are missing or the provider fails, the Firebase Auth action remains complete and the account event records safe fields such as:

- `emailSkipped`
- `emailSkipReason`
- `emailError`

## Admin Recommendation

Admin and owner accounts see a non-blocking warning when 2FA is not enabled. Future hardening should require 2FA before role management, payout changes, marketplace settings changes, account suspension, and admin email sends.

In this phase, 2FA is not hard-required for admin email or other sensitive actions because the production Firebase project may still need TOTP enabled in Firebase Console and the owner must not be accidentally locked out. The UI and docs prepare enforcement; backend permissions still rely on authenticated admin claims.

## Recovery Codes

Recovery codes are intentionally scaffolded only. They are not generated, accepted, or stored in this phase. A future phase should generate one-time codes, show them once, store only hashes server-side, and allow regeneration after reauthentication.

## Manual Test Checklist

1. `/account/security` loads for a signed-in user.
2. Email verification and password reset actions still work or fail safely if email secrets are missing.
3. TOTP setup shows a QR code and manual key.
4. A valid authenticator code enrolls the factor.
5. Sign-in with an enrolled account prompts for the authenticator code.
6. Wrong codes show errors without signing in.
7. Disable 2FA requires confirmation and reauthentication if stale.
8. Inbox System Security shows 2FA events.
9. Admin Account Hub shows email verified and 2FA status without secrets.
