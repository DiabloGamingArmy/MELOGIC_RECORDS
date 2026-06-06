# Account Security Email

Melogic uses Firebase Admin action links plus the Workspace support mailbox for account recovery emails.

- The public auth page exposes a forgot-password flow that calls `requestPasswordResetEmail`.
- Signed-in users can request the same email from `/account/security`.
- Signed-in users can request account email verification from `/account/security`.
- The UI always shows a generic success message so account existence is not revealed.
- Security events are recorded under `users/{uid}/accountEvents` by trusted Cloud Functions.
- Users can read their own account events and mark them read; clients cannot create or delete account events.
- Authenticator-app 2FA is scaffolded in the Security page and will be enabled once the supported Firebase MFA enrollment flow is ready for this app.

## Implementation Status

### Implemented

- Public auth forgot-password flow calls the `requestPasswordResetEmail` callable.
- Signed-in `/account/security` page can send a password reset email to the current account email through the support mailbox.
- Signed-in `/account/security` page can send a verification email to the current Firebase Auth email.
- Trusted functions write account events under `users/{uid}/accountEvents`.
- Product review decisions, reports, role changes, and signed-in password reset requests write account events.
- Inbox System -> Account reads account events separately from core message threads.
- Users can read their own account events and update only `readAt`.
- Firestore rules block client create/delete for account events.
- Admin Account Hub loads recent account events through `getAdminUserProfile`.
- Admin accounts see a missing-2FA warning on `/account/security` while MFA remains scaffolded.
- Admin suspension/unsuspension writes account events so the affected user can see critical account status changes.

### Scaffolded

- Authenticator-app 2FA and recovery codes are visible as disabled foundation controls.
- The Security page reads Firebase enrolled MFA factors if available.

### Pending

- Full TOTP enrollment, disable, and recovery-code callable flow.
- Full account-status enforcement beyond the current stored suspension flag and account event.
- Full enforcement of suspended-account restrictions across every product, report, checkout, and messaging edge.
- Login-success logging is intentionally not enabled to avoid noisy writes.

### Known Risks

- Password reset and verification delivery depend on configured Firebase Functions SMTP secrets for `support@melogicrecords.studio`.
- 2FA controls are intentionally not interactive until the supported Firebase MFA flow is implemented.

## Manual Test Checklist

1. Request forgot-password from the public auth page and confirm the UI shows a generic success message.
2. Open `/account/security` while signed in and confirm provider, email, MFA, and admin warning states match the account.
3. Request verification for an unverified account and confirm the UI shows `Verification email sent.`
4. Confirm account events load under both `/account/security` and Inbox -> System -> Account.
5. Confirm Firestore rules allow users to read/update only their own `readAt` markers and block forged create/delete.
6. Confirm suspended users receive an `account_suspended` event and normal users cannot write suspension fields themselves.

## Deploy Notes

- UI copy or route fixes require Hosting deploy.
- Trusted event-writing changes require deploying the affected account/admin/product/report/email functions.
- Email sending requires the SMTP secrets documented in `docs/email-infrastructure.md`.
